// Voice confirmation for a Web2 application, with no wallet and no chain.
//
// The page records the voice. This server holds the OutLayer payment key, calls the Speak-to-Sign
// verifier, and checks each signed verdict before it accepts an action. Run it with
// `node server.mjs` (Node.js 20 or later). The settings are in README.md.
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

import {
  callVerifier,
  checkVerdict,
  confirmationRequest,
  VERDICT_DOMAIN,
  VerifierCallError,
} from '../../packages/voice-verdict/dist/index.js';

const PORT = Number(process.env.PORT ?? 8787);
const FAKE = process.env.FAKE_VERIFIER === '1';
/** One clip of 8 s is about 342 KB in base64. Enrollment sends three. */
const MAX_BODY_BYTES = 1_200_000;

/** The actions that a user can confirm now. In a real application they come from the session. */
const ACTIONS = [
  { id: 'pay', context: 'shop.example/order', summary: 'Pay forty dollars for two books', order: { id: 1001, total_cents: 4000 } },
  { id: 'cancel', context: 'shop.example/order', summary: 'Cancel my order', order: { id: 1001, cancel: true } },
  { id: 'address', context: 'shop.example/address', summary: 'Deliver it to my office', order: { id: 1001, address: 'office' } },
];

/** The audio digests of the verdicts that this server accepted. A verdict has no nonce. */
const usedAudio = new Map();

const fake = FAKE ? fakeVerifier() : null;
const config = FAKE ? null : readConfig();

function readConfig() {
  const names = [
    'OUTLAYER_BASE_URL',
    'OUTLAYER_PROJECT',
    'OUTLAYER_PAYMENT_KEY',
    'OUTLAYER_SECRETS_PROFILE',
    'OUTLAYER_SECRETS_ACCOUNT_ID',
    'VERIFIER_PUBLIC_KEY',
  ];
  const missing = names.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    console.error(`Set ${missing.join(', ')}, or run with FAKE_VERIFIER=1. See README.md.`);
    process.exit(2);
  }
  const env = (name) => process.env[name].trim();
  return {
    verifier: {
      baseUrl: env('OUTLAYER_BASE_URL'),
      project: env('OUTLAYER_PROJECT'),
      paymentKey: env('OUTLAYER_PAYMENT_KEY'),
      versionKey: process.env.OUTLAYER_VERSION_KEY?.trim() || undefined,
      secretsRef: { profile: env('OUTLAYER_SECRETS_PROFILE'), account_id: env('OUTLAYER_SECRETS_ACCOUNT_ID') },
      timeoutMs: 40_000,
    },
    // The verdict key of your payment key. `enroll` returns it as `verifier_public_key`.
    publicKey: env('VERIFIER_PUBLIC_KEY'),
  };
}

/** The application owner of a user id of this application. */
function ownerOf(user) {
  if (typeof user !== 'string' || !/^[a-z0-9._-]{1,64}$/.test(user)) return null;
  return `app:${user}`;
}

async function candidates(owner) {
  return Promise.all(
    ACTIONS.map((action) =>
      confirmationRequest({
        owner,
        context: action.context,
        payload: new TextEncoder().encode(JSON.stringify(action.order)),
        summary: action.summary,
      }),
    ),
  );
}

async function enroll(body) {
  const owner = ownerOf(body.user);
  if (owner === null || !Array.isArray(body.clips) || body.clips.length !== 3) return [400, { error: 'bad_input' }];
  const input = { op: 'enroll', owner, audio_wav_b64: body.clips };
  const output = fake ? fake.enroll(input) : await callVerifier(config.verifier, input);
  return [200, { outcome: output.outcome, reason: output.reason, verifierPublicKey: output.verifier_public_key }];
}

async function confirm(body) {
  const owner = ownerOf(body.user);
  if (owner === null || typeof body.audio !== 'string') return [400, { error: 'bad_input' }];
  const requests = await candidates(owner);
  const input = {
    op: 'select',
    owner,
    requests: requests.map((candidate) => candidate.request),
    contacts: [],
    audio_wav_b64: body.audio,
  };
  const output = await (fake ? fake.select(input, body.fakeSaid) : callVerifier(config.verifier, input));

  // The output is not proof. The signed verdict is.
  const selected = Number.isInteger(output.selected) ? requests[output.selected] : undefined;
  const audioDigest = createHash('sha256').update(Buffer.from(body.audio, 'base64')).digest();
  const result = await checkVerdict({
    verdictJson: output.verdict_json,
    signatureB64: output.signature_b64 ?? '',
    publicKey: fake ? fake.publicKey : config.publicKey,
    // With no selected request, no digest can match: a zero digest refuses an accept.
    requestDigest: selected?.digest ?? new Uint8Array(32),
    audioDigest,
  });
  if (!result.ok) {
    const { code } = result.refusal;
    const reason = code === 'refused' ? result.refusal.reason : code;
    return [200, { confirmed: false, reason, heard: result.refusal.verdict?.heard ?? null }];
  }
  // One verdict confirms one action. Keep the digest until the verdict expires.
  const now = Date.now();
  for (const [digest, expiry] of usedAudio) if (expiry < now) usedAudio.delete(digest);
  const key = result.verdict.audio_digest;
  if (usedAudio.has(key)) return [200, { confirmed: false, reason: 'verdict_reused', heard: null }];
  usedAudio.set(key, result.verdict.expires_at_ms);
  const action = ACTIONS[output.selected];
  return [200, { confirmed: true, action: action.id, summary: action.summary, heard: result.verdict.heard }];
}

/** A stand-in for the verifier, for a look at the page with no OutLayer account. It checks no voice. */
function fakeVerifier() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const signed = (verdict, extra) => {
    const verdictJson = JSON.stringify(verdict);
    const message = createHash('sha256').update(VERDICT_DOMAIN).update(verdictJson).digest();
    return {
      kind: 'seams_voice_verify_output_v2',
      verdict_json: verdictJson,
      signature_b64: sign(null, message, privateKey).toString('base64'),
      public_key: null,
      policy_text: null,
      ms: {},
      detail: 'fake verifier',
      ...extra,
    };
  };
  return {
    publicKey: new Uint8Array(raw),
    enroll: () => ({ outcome: 'accept', reason: null, verifier_public_key: null }),
    async select(input, said) {
      const index = Number.isInteger(said) && said >= 0 && said < input.requests.length ? said : null;
      const owner = input.owner;
      const digest = index === null ? null : (await candidates(owner))[index].digest;
      const audio = createHash('sha256').update(Buffer.from(input.audio_wav_b64, 'base64')).digest('base64url');
      return signed(
        {
          kind: 'seams_voice_signed_verdict_v2',
          renderer: 'spoken-intent/1',
          verifier: 'fake',
          request_digest: digest === null ? null : Buffer.from(digest).toString('base64url'),
          spoken_text_digest: null,
          audio_digest: audio,
          outcome: index === null ? 'refuse' : 'accept',
          reason: index === null ? 'words' : null,
          policy_rule: null,
          expires_at_ms: Date.now() + 120_000,
          speaker_score_milli: null,
          word_margin_milli: null,
          heard: index === null ? 'something else' : ACTIONS[index].summary.toLowerCase(),
        },
        index === null ? {} : { selected: index },
      );
    },
  };
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

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/record.js': ['record.js', 'text/javascript; charset=utf-8'],
};

const server = createServer(async (request, response) => {
  const send = (status, value, type = 'application/json') => {
    response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    response.end(type === 'application/json' ? JSON.stringify(value) : value);
  };
  try {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (request.method === 'GET' && STATIC[path]) {
      const [file, type] = STATIC[path];
      return send(200, await readFile(new URL(file, import.meta.url)), type);
    }
    if (request.method === 'GET' && path === '/api/actions') {
      return send(200, { fake: FAKE, actions: ACTIONS.map(({ id, summary }) => ({ id, summary })) });
    }
    if (request.method === 'POST' && (path === '/api/enroll' || path === '/api/confirm')) {
      const body = await readJson(request);
      if (body === null) return send(400, { error: 'bad_input' });
      const [status, value] = await (path === '/api/enroll' ? enroll(body) : confirm(body));
      return send(status, value);
    }
    send(404, { error: 'not_found' });
  } catch (cause) {
    if (cause instanceof VerifierCallError) return send(502, { error: `verifier_${cause.code}` });
    console.error(cause);
    send(500, { error: 'server_error' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`http://localhost:${PORT}${FAKE ? ' (fake verifier: no voice is checked)' : ''}`);
});
