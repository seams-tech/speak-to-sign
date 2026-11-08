#!/usr/bin/env node
// Speak-to-Sign demo page server. It stands in for the Wallet on the HTTPS
// path, as demo/demo.py does, but the audio comes from the browser
// microphone.
//
//   GET  /             the page (index.html)
//   GET  /api/state    vault, contacts, pinned verifier key, sentences
//   POST /api/enroll   {wavs_b64: [3 WAVs]} -> NDJSON stage events
//   POST /api/pay      {wav_b64, amount?, contact?} -> NDJSON stage events
//
// The OutLayer payment key comes from the environment (OUTLAYER_PAYMENT_KEY,
// for example with `node --env-file=../../.env`). It is never printed or
// sent to the page. The owner key comes from a near-cli legacy key file
// (--key-file); its private key is never printed or sent to the page.
// The server binds to 127.0.0.1 only.

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const OUTLAYER_URL = "https://testnet-api.outlayer.ai/call/seams-v1.testnet/voice-verifier";
export const VERSION_KEY = "b4d68fb64f8be57382794bd9a8fce60f1655e869260b3fda88953dddf001fdd0";
export const RPC_URL = "https://test.rpc.fastnear.com";
const SECRETS_REF = { profile: "main", account_id: "cyan-loong.testnet" };
const VERDICT_DOMAIN = Buffer.from("seams:outlayer:voice-verdict:v1");
const ENROLLMENT_DOMAIN = Buffer.from("seams:voice-enrollment:v1");
const YOCTO_PER_NEAR = 10n ** 24n;
const YOCTO_PER_HUNDREDTH = 10n ** 22n;
const TRANSFER_GAS = 50n * 10n ** 12n;
const AUTHORIZE_GAS = 10n * 10n ** 12n;
const POLL_MS = 100;
const SETTLE_TIMEOUT_MS = 60_000;
const MAX_BODY_BYTES = 2_000_000;
export const ENROLL_PHRASES = [
  "My voice is my signature for this vault.",
  "I send money only to the contacts I saved.",
  "Seams, please learn how I sound today.",
];
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

// ---------------------------------------------------------------------------
// Pure helpers (ports of demo.py; see test.mjs)

export function b58decode(text) {
  let number = 0n;
  for (const char of text) {
    const index = B58.indexOf(char);
    if (index < 0) throw new Error("bad base58");
    number = number * 58n + BigInt(index);
  }
  let hex = number === 0n ? "" : number.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  const zeros = text.length - text.replace(/^1+/, "").length;
  return Buffer.concat([Buffer.alloc(zeros), Buffer.from(hex, "hex")]);
}

export function b58encode(data) {
  let number = BigInt("0x" + (Buffer.from(data).toString("hex") || "0"));
  let digits = "";
  while (number > 0n) {
    digits = B58[Number(number % 58n)] + digits;
    number /= 58n;
  }
  const zeros = data.length - Buffer.from(data).toString("hex").replace(/^(00)+/, "").length / 2;
  return "1".repeat(zeros) + digits;
}

const b64u = (data) => Buffer.from(data).toString("base64url");
const sha256 = (data) => crypto.createHash("sha256").update(data).digest();

/** The verifier's canonical WAV of a 16 kHz mono PCM16 WAV: a 44-byte header,
 * then the samples. Its SHA-256 is the audio digest. */
export function canonicalWav(data) {
  if (data.length < 12 || data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("not a WAV file");
  }
  let format = null;
  let pcm = null;
  for (let at = 12; at + 8 <= data.length;) {
    const id = data.toString("ascii", at, at + 4);
    const size = data.readUInt32LE(at + 4);
    const body = data.subarray(at + 8, Math.min(data.length, at + 8 + size));
    if (id === "fmt ") format = body;
    if (id === "data") pcm = body;
    at += 8 + size + (size % 2);
  }
  if (!format || !pcm) throw new Error("WAV has no fmt or data chunk");
  const shape = [format.readUInt16LE(0), format.readUInt16LE(2), format.readUInt32LE(4), format.readUInt16LE(14)];
  if (shape.join() !== "1,1,16000,16") throw new Error(`not a 16 kHz mono PCM16 WAV: ${shape.join(",")}`);
  pcm = pcm.subarray(0, pcm.length - (pcm.length % 2));
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export const wavSeconds = (canonical) => (canonical.length - 44) / 32000;

/** base64url SHA-256(domain || vault || 0 || owner || 0 || d1 || d2 || d3). */
export function enrollmentDigest(vault, owner, audioDigests) {
  return b64u(sha256(Buffer.concat([ENROLLMENT_DOMAIN, Buffer.from(vault), Buffer.alloc(1), Buffer.from(owner),
    Buffer.alloc(1), ...audioDigests])));
}

/** '2', '2.5' or '0.01' NEAR to yoctoNEAR; whole hundredths only. */
export function nearToYocto(text) {
  const match = /^(\d+)(?:\.(\d{1,24}))?$/.exec(String(text).trim());
  if (!match) throw new Error(`not a number: ${text}`);
  const yocto = BigInt(match[1]) * YOCTO_PER_NEAR + BigInt((match[2] || "").padEnd(24, "0") || "0");
  if (yocto <= 0n || yocto % YOCTO_PER_HUNDREDTH) throw new Error(`amount must be whole hundredths of NEAR: ${text}`);
  return yocto;
}

export function spokenAccount(accountId) {
  return accountId.replaceAll(".", " dot ").replaceAll("-", " dash ").replaceAll("_", " underscore ")
    .split(/\s+/).filter(Boolean).join(" ");
}

export const payPhrase = (amount, contact) => `Send ${amount} NEAR to ${spokenAccount(contact)}.`;

export function findKey(value, name) {
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findKey(child, name);
      if (found !== undefined && found !== null) return found;
    }
  } else if (value && typeof value === "object") {
    if (name in value) return value[name];
    return findKey(Object.values(value), name);
  }
  return undefined;
}

export function workerOutput(response) {
  let output = findKey(response, "output");
  if (typeof output === "string") {
    try {
      output = JSON.parse(output);
    } catch {
      return null;
    }
  }
  return output && typeof output === "object" && !Array.isArray(output) ? output : null;
}

export function txProgress(result) {
  const firstIds = findKey(result.transaction_outcome || {}, "receipt_ids") || [];
  const outcomes = new Map((result.receipts_outcome || []).map((item) => [item.id, item.outcome || {}]));
  let accepted = null;
  if (firstIds.length && outcomes.has(firstIds[0])) {
    const status = outcomes.get(firstIds[0]).status || {};
    if ("SuccessValue" in status || "SuccessReceiptId" in status) accepted = true;
    else if ("Failure" in status) accepted = false;
  }
  const status = result.status;
  const settled = !!status && typeof status === "object" && ("SuccessValue" in status || "Failure" in status);
  const failures = [...outcomes.values()].filter((o) => o.status && "Failure" in o.status).map((o) => o.status);
  const logs = [...outcomes.values()].flatMap((o) => o.logs || []);
  return { accepted, settled, failures, logs };
}

function borshString(value) {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const length = Buffer.alloc(4);
  length.writeUInt32LE(data.length);
  return Buffer.concat([length, data]);
}

function u64(value) {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(BigInt(value));
  return out;
}

function u128(value) {
  const out = Buffer.alloc(16);
  out.writeBigUInt64LE(BigInt(value) & 0xffffffffffffffffn, 0);
  out.writeBigUInt64LE(BigInt(value) >> 64n, 8);
  return out;
}

/** Borsh Transaction (v0) with one FunctionCall action (enum index 2). */
export function functionCallTx(signer, publicKey, nonce, receiver, blockHash, method, args, gas, deposit) {
  const count = Buffer.alloc(4);
  count.writeUInt32LE(1);
  return Buffer.concat([borshString(signer), Buffer.from([0]), publicKey, u64(nonce), borshString(receiver),
    blockHash, count, Buffer.from([2]), borshString(method), borshString(args), u64(gas), u128(deposit)]);
}

export function signedTxBase64(tx, privateKey) {
  const signature = crypto.sign(null, sha256(tx), privateKey);
  return Buffer.concat([tx, Buffer.from([0]), signature]).toString("base64");
}

export const verdictMessage = (verdictJson) => sha256(Buffer.concat([VERDICT_DOMAIN, Buffer.from(verdictJson)]));

export function verifyVerdict(verdictJson, signatureB64, publicKeyText) {
  const x = b58decode(publicKeyText.split(":")[1]);
  const key = crypto.createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: b64u(x) }, format: "jwk" });
  return crypto.verify(null, verdictMessage(verdictJson), key, Buffer.from(signatureB64, "base64"));
}

export function loadOwnerKey(file) {
  const keyFile = JSON.parse(fs.readFileSync(file.replace(/^~/, os.homedir()), "utf8"));
  const secret = b58decode(keyFile.private_key.split(":")[1]);
  const seed = secret.subarray(0, 32);
  const publicKey = b58decode(keyFile.public_key.split(":")[1]);
  const privateKey = crypto.createPrivateKey({
    key: { kty: "OKP", crv: "Ed25519", d: b64u(seed), x: b64u(publicKey) }, format: "jwk",
  });
  // The key pair must match: sign a test message and check it.
  const probe = crypto.sign(null, Buffer.from("probe"), privateKey);
  const pub = crypto.createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: b64u(publicKey) }, format: "jwk" });
  if (!crypto.verify(null, Buffer.from("probe"), pub, probe)) throw new Error("key file public key does not match");
  return { privateKey, publicKey, publicKeyText: keyFile.public_key, accountId: keyFile.account_id };
}

// ---------------------------------------------------------------------------
// Network

async function postJson(url, body, headers = {}, timeoutMs = 60_000) {
  const response = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: response.status, text: await response.text() };
}

export async function rpc(method, params, timeoutMs = 60_000) {
  const { status, text } = await postJson(RPC_URL, { jsonrpc: "2.0", id: "web", method, params }, {}, timeoutMs);
  const reply = JSON.parse(text);
  if (status !== 200 || reply.error) throw new Error(JSON.stringify(reply.error || reply).slice(0, 400));
  return reply.result;
}

export async function view(contract, method, args, finality = "optimistic") {
  const result = await rpc("query", {
    request_type: "call_function", finality, account_id: contract, method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  return JSON.parse(Buffer.from(result.result).toString());
}

async function txInputs(owner, publicKeyText) {
  const [access, block] = await Promise.all([
    rpc("query", { request_type: "view_access_key", finality: "optimistic", account_id: owner, public_key: publicKeyText }),
    rpc("block", { finality: "final" }),
  ]);
  return { nonce: access.nonce + 1, blockHash: b58decode(block.header.hash) };
}

async function callOutlayer(cfg, payload) {
  const body = {
    input: payload, async: false, secrets_ref: SECRETS_REF, version_key: cfg.versionKey,
    resource_limits: { max_instructions: 10_000_000_000, max_memory_mb: 256, max_execution_seconds: 60 },
  };
  const started = performance.now();
  const { status, text } = await postJson(cfg.url, body, { "X-Payment-Key": cfg.paymentKey }, 120_000);
  const wallMs = Math.round(performance.now() - started);
  let response;
  try {
    response = JSON.parse(text);
  } catch {
    throw new Error(`OutLayer HTTP ${status}, non-JSON reply (${text.length} bytes)`);
  }
  const output = workerOutput(response);
  if (status !== 200 || !output) throw new Error(`OutLayer HTTP ${status}: ${JSON.stringify(response).slice(0, 300)}`);
  return { output, wallMs, timeMs: findKey(response, "time_ms") ?? null };
}

const nearblocks = (hash) => `https://testnet.nearblocks.io/txns/${hash}`;

// ---------------------------------------------------------------------------
// Flows. `emit` sends one stage event to the page.

export async function payFlow(cfg, input, emit) {
  const contact = input.contact || cfg.contact;
  const amountText = String(input.amount || cfg.amount);
  const amountYocto = nearToYocto(amountText);
  const wav = canonicalWav(Buffer.from(String(input.wav_b64 || ""), "base64"));
  const seconds = wavSeconds(wav);
  if (seconds <= 0 || seconds > 8) throw new Error(`the clip is ${seconds.toFixed(2)} s; it must be 0–8 s`);
  const t0 = performance.now();
  const since = () => Math.round(performance.now() - t0);
  emit({ stage: "received", seconds: Number(seconds.toFixed(2)), phrase: payPhrase(amountText, contact) });

  // Vault state and tx inputs, at the same time as the verify call needs
  // the nonce first. A Wallet reads these before speech; here they are
  // fresh reads, timed apart from the verify call.
  const [vault, contacts, verifier, inputs] = await Promise.all([
    view(cfg.vault, "get_vault", { owner_id: cfg.owner }),
    view(cfg.vault, "get_contacts", { owner_id: cfg.owner }),
    view(cfg.vault, "get_verifier", {}),
    txInputs(cfg.owner, cfg.key.publicKeyText),
  ]);
  if (!vault) throw new Error(`${cfg.owner} has no vault on ${cfg.vault}`);
  const names = contacts.map((c) => c.account_id);
  if (!contacts.some((c) => c.account_id === contact && c.active)) throw new Error(`${contact} is not an active contact`);
  const pinned = verifier.verifier_public_key;
  const nonce = Number(vault.next_nonce);
  emit({ stage: "state", ms: since(), nonce, contacts: names, pinned });

  const tVerify = performance.now();
  const payload = {
    op: "verify", vault: cfg.vault, owner: cfg.owner, receiver: contact, amount_yocto: amountYocto.toString(),
    nonce, contacts: names, audio_wav_b64: wav.toString("base64"),
  };
  const { output, wallMs, timeMs } = await callOutlayer(cfg, payload);
  const verdictText = output.verdict_json || "{}";
  const verdict = JSON.parse(verdictText);
  emit({
    stage: "verified", ms: wallMs, since_received_ms: Math.round(performance.now() - t0), outlayer_time_ms: timeMs,
    worker_ms: output.ms || {}, outcome: verdict.outcome, reason: verdict.reason,
    speaker_score_milli: verdict.speaker_score_milli, word_margin_milli: verdict.word_margin_milli,
    heard: verdict.heard, detail: output.detail ?? null,
  });
  if (verdict.outcome !== "accept" || !output.signature_b64) {
    emit({ stage: "refused", by: "verifier", reason: verdict.reason || "unknown", detail: output.detail ?? null });
    return;
  }

  // The Wallet checks the signature and the key before it pays for gas.
  if (output.public_key !== pinned) throw new Error(`verdict key ${output.public_key} is not the pinned key ${pinned}`);
  if (!verifyVerdict(verdictText, output.signature_b64, pinned)) throw new Error("the verdict signature does not verify");

  const callArgs = Buffer.from(JSON.stringify({
    receiver_id: contact, amount: amountYocto.toString(), nonce: String(nonce), verdict_json: verdictText,
    signature_b64: output.signature_b64,
  }));
  const tx = functionCallTx(cfg.owner, cfg.key.publicKey, inputs.nonce, cfg.vault, inputs.blockHash,
    "transfer_with_verdict", callArgs, TRANSFER_GAS, 0n);
  const txHash = b58encode(sha256(tx));
  const signed = signedTxBase64(tx, cfg.key.privateKey);
  const verifyToSend = Math.round(performance.now() - tVerify);
  emit({ stage: "sent", tx_hash: txHash, url: nearblocks(txHash), since_received_ms: since(), verify_to_send_ms: verifyToSend });

  const sent = performance.now();
  await rpc("send_tx", { signed_tx_base64: signed, wait_until: "NONE" });
  let acceptedMs = null;
  let progress = { accepted: null, settled: false, failures: [], logs: [] };
  let result = {};
  while (performance.now() - sent < SETTLE_TIMEOUT_MS) {
    try {
      result = await rpc("EXPERIMENTAL_tx_status", { tx_hash: txHash, sender_account_id: cfg.owner, wait_until: "NONE" }, 15_000);
    } catch (error) {
      if (/UNKNOWN_TRANSACTION|TIMEOUT_ERROR/.test(String(error))) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        continue;
      }
      throw error;
    }
    progress = txProgress(result);
    const nowMs = Math.round(performance.now() - sent);
    if (progress.accepted !== null && acceptedMs === null) {
      acceptedMs = nowMs;
      emit({ stage: progress.accepted ? "vault_accepted" : "vault_refused", ms: nowMs, since_received_ms: since() });
      if (!progress.accepted) break;
    }
    if (progress.settled) {
      emit({ stage: "settled", ms: nowMs, since_received_ms: since() });
      break;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  const ok = progress.accepted && result.status && "SuccessValue" in result.status && !progress.failures.length;
  emit({
    stage: ok ? "done" : "refused", by: ok ? undefined : "vault", tx_hash: txHash, url: nearblocks(txHash),
    logs: progress.logs.map((l) => l.slice(0, 300)), failures: JSON.stringify(progress.failures).slice(0, 400),
    reason: ok ? undefined : "vault",
  });
}

export async function enrollFlow(cfg, input, emit) {
  const clips = (input.wavs_b64 || []).map((b) => canonicalWav(Buffer.from(String(b), "base64")));
  if (clips.length !== 3) throw new Error("enrollment needs three recordings");
  for (const clip of clips) {
    const s = wavSeconds(clip);
    if (s <= 0 || s > 8) throw new Error(`a clip is ${s.toFixed(2)} s; each must be 0–8 s`);
  }
  const digest = enrollmentDigest(cfg.vault, cfg.owner, clips.map(sha256));
  emit({ stage: "received", seconds: clips.map((c) => Number(wavSeconds(c).toFixed(2))), enrollment_digest: digest });

  // The owner authorizes exactly these three recordings (FINAL: the
  // verifier reads the vault with finality final).
  const { nonce, blockHash } = await txInputs(cfg.owner, cfg.key.publicKeyText);
  const tx = functionCallTx(cfg.owner, cfg.key.publicKey, nonce, cfg.vault, blockHash, "authorize_enrollment",
    Buffer.from(JSON.stringify({ enrollment_digest: digest })), AUTHORIZE_GAS, 0n);
  const started = performance.now();
  const result = await rpc("send_tx", { signed_tx_base64: signedTxBase64(tx, cfg.key.privateKey), wait_until: "FINAL" });
  const hash = result.transaction.hash;
  const authorized = result.status && "SuccessValue" in result.status;
  emit({ stage: "authorized", ms: Math.round(performance.now() - started), tx_hash: hash, url: nearblocks(hash), ok: !!authorized });
  if (!authorized) {
    emit({ stage: "refused", by: "vault", reason: "authorize_failed", detail: JSON.stringify(result.status).slice(0, 300) });
    return;
  }
  const pending = await view(cfg.vault, "get_pending_enrollment", { owner_id: cfg.owner }, "final");
  if (!pending || pending.enrollment_digest !== digest) throw new Error("the vault's final pending enrollment is not this digest");

  const { output, wallMs, timeMs } = await callOutlayer(cfg, {
    op: "enroll", vault: cfg.vault, owner: cfg.owner, audio_wav_b64: clips.map((c) => c.toString("base64")),
  });
  emit({
    stage: "enrolled", ms: wallMs, outlayer_time_ms: timeMs, outcome: output.outcome, reason: output.reason ?? null,
    agreement_milli: output.agreement_milli ?? null, template_epoch: output.template_epoch ?? null,
    verifier_public_key: output.verifier_public_key ?? null, detail: output.detail ?? null, worker_ms: output.ms || {},
  });
  emit(output.outcome === "accept"
    ? { stage: "done" }
    : { stage: "refused", by: "verifier", reason: output.reason || "unknown", detail: output.detail ?? null });
}

// ---------------------------------------------------------------------------
// HTTP

function readBody(request) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request too large"));
        request.destroy();
      } else parts.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(parts)));
    request.on("error", reject);
  });
}

function streamFlow(response, flow, cfg, input, name) {
  response.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" });
  const emit = (event) => {
    response.write(JSON.stringify(event) + "\n");
    console.log(`${name} ${JSON.stringify(event)}`);
  };
  return flow(cfg, input, emit)
    .catch((error) => emit({ stage: "error", error: String(error.message || error).slice(0, 400) }))
    .finally(() => response.end());
}

export function makeServer(cfg) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  let busy = false;
  return http.createServer(async (request, response) => {
    // Refuse requests whose Host is not this loopback server (DNS rebinding).
    const host = String(request.headers.host || "");
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
      response.writeHead(403).end("forbidden host");
      return;
    }
    try {
      if (request.method === "GET" && (request.url === "/" || request.url === "/index.html")) {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        response.end(fs.readFileSync(path.join(here, "index.html")));
      } else if (request.method === "GET" && request.url === "/api/state") {
        const [vault, contacts, verifier] = await Promise.all([
          view(cfg.vault, "get_vault", { owner_id: cfg.owner }),
          view(cfg.vault, "get_contacts", { owner_id: cfg.owner }),
          view(cfg.vault, "get_verifier", {}),
        ]);
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({
          vault_contract: cfg.vault, owner: cfg.owner, contact: cfg.contact, amount: cfg.amount,
          phrase: payPhrase(cfg.amount, cfg.contact), enroll_phrases: ENROLL_PHRASES, vault, contacts,
          verifier_public_key: verifier.verifier_public_key, version_key: cfg.versionKey,
          vault_url: `https://testnet.nearblocks.io/address/${cfg.vault}`,
        }));
      } else if (request.method === "POST" && (request.url === "/api/pay" || request.url === "/api/enroll")) {
        // Same-origin JSON only; a cross-site form cannot set this type.
        if (!String(request.headers["content-type"] || "").startsWith("application/json")) {
          response.writeHead(415).end("send application/json");
          return;
        }
        if (busy) {
          response.writeHead(409, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "busy: one request at a time" }));
          return;
        }
        busy = true;
        try {
          const input = JSON.parse((await readBody(request)).toString());
          const pay = request.url === "/api/pay";
          await streamFlow(response, pay ? payFlow : enrollFlow, cfg, input, pay ? "pay" : "enroll");
        } finally {
          busy = false;
        }
      } else {
        response.writeHead(404).end("not found");
      }
    } catch (error) {
      if (!response.headersSent) response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: String(error.message || error).slice(0, 400) }));
    }
  });
}

function parseArgs(argv) {
  const options = {
    port: 8787, vault: "seams-wallet.testnet", owner: "w3a-dev-1766307589.testnet", contact: "seams-v1.testnet",
    amount: "0.1", url: OUTLAYER_URL, versionKey: VERSION_KEY, keyFile: null,
  };
  const names = { "--port": "port", "--vault": "vault", "--owner": "owner", "--contact": "contact", "--amount": "amount",
    "--url": "url", "--version-key": "versionKey", "--key-file": "keyFile" };
  for (let i = 0; i < argv.length; i += 2) {
    const name = names[argv[i]];
    if (!name || argv[i + 1] === undefined) throw new Error(`unknown or incomplete flag ${argv[i]}`);
    options[name] = argv[i + 1];
  }
  if (!options.keyFile) throw new Error("--key-file <near-cli key file of the owner> is required");
  options.port = Number(options.port);
  return options;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const options = parseArgs(process.argv.slice(2));
  const paymentKey = process.env.OUTLAYER_PAYMENT_KEY;
  if (!paymentKey) {
    console.error("error: OUTLAYER_PAYMENT_KEY is not in the environment (run with node --env-file=<file>)");
    process.exit(2);
  }
  const key = loadOwnerKey(options.keyFile);
  if (key.accountId && key.accountId !== options.owner) {
    console.error(`error: the key file is for ${key.accountId}, not the owner ${options.owner}`);
    process.exit(2);
  }
  nearToYocto(options.amount);
  const cfg = { ...options, paymentKey, key };
  makeServer(cfg).listen(options.port, "127.0.0.1", () => {
    console.log(`Speak-to-Sign demo on http://127.0.0.1:${options.port}/  owner ${options.owner}  vault ${options.vault}`);
  });
}
