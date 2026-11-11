// Voice confirmation for a Web2 application, with no wallet and no chain.
//
// The page records the voice with `@seams/voice-sign/browser`. This server holds the OutLayer
// payment key and uses `@seams/voice-sign/server`: each result is a checked verdict. Run it
// with `node server.mjs` (Node.js 20 or later). The settings are in README.md.
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSpeakToSign, VerifierCallError } from '../../packages/voice-sign/dist/server.js';
import { audioDigest, confirmationRequest, VERDICT_DOMAIN } from '../../packages/voice-verdict/dist/index.js';

const PORT = Number(process.env.PORT ?? 8787);
const FAKE = process.env.FAKE_VERIFIER === '1';
/** One clip of 8 s is about 342 KB in base64. Enrollment sends three. */
const MAX_BODY_BYTES = 1_200_000;

/** The actions that a user can confirm now. In a real application they come from the session. */
const ACTIONS = [
  { id: 'pay', context: 'shop.example/order', summary: 'Pay for my order', order: { id: 1001, total_cents: 4000 } },
  { id: 'cancel', context: 'shop.example/order', summary: 'Cancel my order', order: { id: 1001, cancel: true } },
  { id: 'address', context: 'shop.example/address', summary: 'Deliver it to my office', order: { id: 1001, address: 'office' } },
].map((action) => ({ ...action, payload: new TextEncoder().encode(JSON.stringify(action.order)) }));

const speakToSign = FAKE ? fakeSpeakToSign() : realSpeakToSign();

function realSpeakToSign() {
  const names = ['OUTLAYER_BASE_URL', 'OUTLAYER_PROJECT', 'OUTLAYER_PAYMENT_KEY', 'OUTLAYER_SECRETS_PROFILE', 'OUTLAYER_SECRETS_ACCOUNT_ID', 'VERIFIER_PUBLIC_KEY'];
  const missing = names.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    console.error(`Set ${missing.join(', ')}, or run with FAKE_VERIFIER=1. See README.md.`);
    process.exit(2);
  }
  const env = (name) => process.env[name].trim();
  const versionKey = process.env.OUTLAYER_VERSION_KEY?.trim() || undefined;
  return createSpeakToSign({
    verifier: {
      baseUrl: env('OUTLAYER_BASE_URL'),
      project: env('OUTLAYER_PROJECT'),
      paymentKey: env('OUTLAYER_PAYMENT_KEY'),
      versionKey,
      secretsRef: { profile: env('OUTLAYER_SECRETS_PROFILE'), account_id: env('OUTLAYER_SECRETS_ACCOUNT_ID') },
      timeoutMs: 40_000,
    },
    // The verdict key of your payment key. `enroll` returns it as `verifierPublicKey`.
    verifierPublicKey: env('VERIFIER_PUBLIC_KEY'),
    // With CHECK_TDX_QUOTE=1, each confirmation also needs the TDX quote of its call, for the
    // version key above, with measurements that the OutLayer contract approves.
    ...(process.env.CHECK_TDX_QUOTE === '1' && versionKey
      ? { attestation: { acceptedWasmHashes: [versionKey], near: { rpcUrl: 'https://test.rpc.fastnear.com/', contract: 'worker.outlayer.testnet' } } }
      : {}),
  });
}

/** The application owner of a user id of this application. */
function ownerOf(user) {
  return typeof user === 'string' && /^[a-z0-9._-]{1,64}$/.test(user) ? `app:${user}` : null;
}

async function enroll(body) {
  const owner = ownerOf(body.user);
  if (owner === null || !Array.isArray(body.clips)) return [400, { error: 'bad_input' }];
  const result = await speakToSign.enroll({ owner, recordings: body.clips });
  return [200, result.ok ? { outcome: 'accept', verifierPublicKey: result.verifierPublicKey } : { outcome: 'refuse', reason: result.reason }];
}

async function confirm(body) {
  const owner = ownerOf(body.user);
  if (owner === null || typeof body.audio !== 'string') return [400, { error: 'bad_input' }];
  if (FAKE) fakeSaid = body.fakeSaid;
  const result = await speakToSign.select({ owner, actions: ACTIONS, recording: body.audio });
  if (!result.ok) return [200, { confirmed: false, reason: result.reason, heard: result.heard }];
  // The verdict passed every check. Do the action here, one time.
  const action = ACTIONS[result.index];
  return [200, { confirmed: true, action: action.id, summary: action.summary, heard: result.heard }];
}

/**
 * The same server code with a stand-in for the verifier, for a look at the page with no OutLayer
 * account. It checks no voice: the page says which sentence it "hears".
 */
let fakeSaid = null;
function fakeSpeakToSign() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const key = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const fetchFake = async (_url, init) => {
    const { input } = JSON.parse(init.body);
    if (input.op === 'enroll') {
      const output = { kind: 'seams_voice_enrollment_v3', outcome: 'accept', reason: null, template_epoch: 1, agreement_milli: null, verifier_public_key: null, detail: 'fake verifier' };
      return Response.json({ status: 'completed', output });
    }
    const index = Number.isInteger(fakeSaid) && fakeSaid >= 0 && fakeSaid < input.requests.length ? fakeSaid : null;
    const request = index === null ? null : input.requests[index];
    const built = request && (await confirmationRequest({ owner: input.owner, context: request.context, summary: request.summary, payloadSha256: request.payload_sha256_hex }));
    const verdict = JSON.stringify({
      kind: 'seams_voice_signed_verdict_v2',
      renderer: 'spoken-intent/1',
      verifier: 'fake',
      request_digest: built ? Buffer.from(built.digest).toString('base64url') : null,
      // The real verifier signs the digest of the sentence that it rendered. This stand-in does
      // not render, and the page does not check this digest, so any 32 bytes stand in for it.
      spoken_text_digest: built ? Buffer.alloc(32, 7).toString('base64url') : null,
      audio_digest: Buffer.from(await audioDigest(new Uint8Array(Buffer.from(input.audio_wav_b64, 'base64')))).toString('base64url'),
      outcome: built ? 'accept' : 'refuse',
      reason: built ? null : 'words',
      policy_rule: null,
      expires_at_ms: Date.now() + 120_000,
      speaker_score_milli: null,
      word_margin_milli: null,
      heard: built ? request.summary.toLowerCase() : 'something else',
    });
    const message = createHash('sha256').update(VERDICT_DOMAIN).update(verdict).digest();
    const output = {
      kind: 'seams_voice_verify_output_v2',
      verdict_json: verdict,
      signature_b64: sign(null, message, privateKey).toString('base64'),
      public_key: null,
      policy_text: null,
      ms: {},
      detail: 'fake verifier',
      ...(built ? { selected: index } : {}),
    };
    return Response.json({ status: 'completed', output });
  };
  return createSpeakToSign({
    verifier: { baseUrl: 'https://fake.invalid', project: 'fake/verifier', paymentKey: 'none', secretsRef: { profile: 'none', account_id: 'none' }, fetch: fetchFake },
    verifierPublicKey: new Uint8Array(key).reduce((hex, byte) => hex + byte.toString(16).padStart(2, '0'), ''),
  });
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return typeof body === 'object' && body !== null ? body : null;
  } catch {
    return null;
  }
}

/** The files of the page, and the two packages that the page loads with no bundler. */
const packages = fileURLToPath(new URL('../../packages/', import.meta.url));
const FOLDERS = {
  '/voice-sign/': path.join(packages, 'voice-sign/dist/'),
  '/voice-capture/': path.join(packages, 'voice-capture/dist/'),
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm' };

async function staticFile(pathname) {
  if (pathname === '/') return [await readFile(new URL('index.html', import.meta.url)), TYPES['.html']];
  for (const [prefix, folder] of Object.entries(FOLDERS)) {
    if (!pathname.startsWith(prefix)) continue;
    const file = path.join(folder, path.normalize(pathname.slice(prefix.length)));
    if (!file.startsWith(folder)) return null;
    try {
      return [await readFile(file), TYPES[path.extname(file)] ?? 'application/octet-stream'];
    } catch {
      return null;
    }
  }
  return null;
}

const server = createServer(async (request, response) => {
  const send = (status, value, type = 'application/json') => {
    response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    response.end(type === 'application/json' ? JSON.stringify(value) : value);
  };
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (request.method === 'GET' && pathname === '/api/actions') {
      return send(200, { fake: FAKE, actions: ACTIONS.map(({ id, summary }) => ({ id, summary })) });
    }
    if (request.method === 'GET') {
      const file = await staticFile(pathname);
      return file ? send(200, file[0], file[1]) : send(404, { error: 'not_found' });
    }
    if (request.method === 'POST' && (pathname === '/api/enroll' || pathname === '/api/confirm')) {
      const body = await readJson(request);
      if (body === null) return send(400, { error: 'bad_input' });
      const [status, value] = await (pathname === '/api/enroll' ? enroll(body) : confirm(body));
      return send(status, value);
    }
    send(404, { error: 'not_found' });
  } catch (cause) {
    if (cause instanceof VerifierCallError) return send(502, { error: `verifier_${cause.code}` });
    if (cause instanceof RangeError) return send(400, { error: 'bad_input' });
    console.error(cause);
    send(500, { error: 'server_error' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`http://localhost:${PORT}${FAKE ? ' (fake verifier: no voice is checked)' : ''}`);
});
