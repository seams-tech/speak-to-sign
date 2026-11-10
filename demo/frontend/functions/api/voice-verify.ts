// POST /api/voice-verify  { input }  ->  the verifier output, unchanged  or  { error }
//
// Runs the OutLayer voice verifier for the voice multisig screen, with the demo's own OutLayer
// payment key, the way the Seams verify route does (/speak-to-sign/v1/verify). It takes only
// the `verify` op with the request kind `multisig_propose` (a transfer) or `multisig_hide_note`
// (a reported note; verifier 0.7.0 or later).
//
// The Seams route checks that the caller owns `owner`; this route cannot. The verifier still
// checks the voice against the owner's template, and the contract checks that the owner signs
// the transaction, so a verdict is bound to the owner's voice and key.
//
// Over HTTPS, OutLayer derives the verifier's storage cell and its verdict signing key from the
// owner of the payment key. The visitors enroll their voices through the Seams staging server,
// so this route must use the same payment key, project and secrets profile as that route, and a
// verifier version with the multisig kinds (0.6.0 or later). With another payment key, every
// verify refuses `template_missing`, and the verdicts carry a key that the contract does not pin.

import { isObject } from '../../src/guards.ts';
import { json, readBoundedText, refuseOtherOrigin } from '../lib/http.ts';

interface Env {
  /** For example https://api.outlayer.fastnear.com */
  VOICE_OUTLAYER_BASE_URL?: string;
  /** owner/project, for example seams-v1.testnet/voice-verifier */
  VOICE_OUTLAYER_PROJECT?: string;
  /** The WASM hash of a verifier version that has the multisig kinds (0.6.0 or later). */
  VOICE_OUTLAYER_VERSION_KEY?: string;
  /** The OutLayer payment key of the Seams staging verify route. It goes only into the X-Payment-Key header. */
  VOICE_OUTLAYER_PAYMENT_KEY?: string;
  VOICE_OUTLAYER_SECRETS_PROFILE?: string;
  VOICE_OUTLAYER_SECRETS_ACCOUNT_ID?: string;
}

const ENV_NAMES = [
  'VOICE_OUTLAYER_BASE_URL',
  'VOICE_OUTLAYER_PROJECT',
  'VOICE_OUTLAYER_VERSION_KEY',
  'VOICE_OUTLAYER_PAYMENT_KEY',
  'VOICE_OUTLAYER_SECRETS_PROFILE',
  'VOICE_OUTLAYER_SECRETS_ACCOUNT_ID',
] as const;

/** One clip: 8 s of 16 kHz PCM16 is a 256,044-byte WAV, about 342 KB in base64, with room for the fields. */
const MAX_BODY_BYTES = 400 * 1024;
/** The verifier calls two remote models. */
const TIMEOUT_MS = 20_000;
/** The proposal kinds of the voice multisig page. */
const REQUEST_KINDS = ['multisig_propose', 'multisig_hide_note'];
const RESOURCE_LIMITS = { max_instructions: 10_000_000_000, max_memory_mb: 128, max_execution_seconds: 15 };

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const refused = refuseOtherOrigin(request);
  if (refused) return refused;
  const outlayer = readConfig(env);
  if (typeof outlayer === 'string') return json({ error: outlayer }, 503);

  const text = await readBoundedText(request, MAX_BODY_BYTES);
  if (text === null) return json({ error: 'The recording is too long. Record 8 seconds or less.' }, 413);
  const input = parseInput(text);
  if (typeof input === 'string') return json({ error: input }, 400);

  let response: Response;
  try {
    response = await fetch(outlayer.callUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Payment-Key': outlayer.paymentKey },
      body: JSON.stringify({
        input,
        async: false,
        version_key: outlayer.versionKey,
        secrets_ref: outlayer.secretsRef,
        resource_limits: RESOURCE_LIMITS,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (cause) {
    const timedOut = cause instanceof DOMException && cause.name === 'TimeoutError';
    return json({ error: timedOut ? 'The verifier did not answer in time. Try again.' : 'The verifier is not reachable.' }, 502);
  }
  if (!response.ok) return json({ error: outlayerFailure(response.status) }, 502);
  const output = readOutlayerOutput(await response.text());
  if (output === null) return json({ error: 'The verifier run did not complete. Try again.' }, 502);
  return json(output);
};

export const onRequestGet: PagesFunction<Env> = async () => json({ error: 'Use POST with { "input": { ... } }.' }, 405, { Allow: 'POST' });

interface OutlayerConfig {
  callUrl: string;
  versionKey: string;
  paymentKey: string;
  secretsRef: { profile: string; account_id: string };
}

/** The OutLayer settings, or the reason that the route cannot run. */
function readConfig(env: Env): OutlayerConfig | string {
  const values = ENV_NAMES.map((name) => env[name]?.trim() ?? '');
  const missing = ENV_NAMES.filter((_, index) => values[index] === '');
  if (missing.length > 0) return `The voice verifier is not set up on this server. It needs ${missing.join(', ')}.`;
  const [baseUrl = '', project = '', versionKey = '', paymentKey = '', profile = '', accountId = ''] = values;
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return 'VOICE_OUTLAYER_BASE_URL is not a URL.';
  }
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) {
    return 'VOICE_OUTLAYER_BASE_URL must be a plain HTTPS URL.';
  }
  if (!/^[a-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(project)) return 'VOICE_OUTLAYER_PROJECT must be owner/project.';
  return {
    callUrl: `${base.origin}${base.pathname.replace(/\/+$/, '')}/call/${project}`,
    versionKey,
    paymentKey,
    secretsRef: { profile, account_id: accountId },
  };
}

/** The verifier input of `{ input }`, or the reason for a 400. The verifier checks the rest. */
function parseInput(text: string): Record<string, unknown> | string {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return 'Send JSON in the form { "input": { ... } }.';
  }
  if (!isObject(body) || Object.keys(body).length !== 1 || !isObject(body.input)) {
    return 'Send JSON in the form { "input": { ... } }.';
  }
  const { input } = body;
  if (input.op !== 'verify') return 'This route runs only the verify op.';
  if (!isObject(input.request) || !REQUEST_KINDS.includes(String(input.request.kind))) {
    return 'This route takes only the request kinds multisig_propose and multisig_hide_note.';
  }
  return input;
}

/** The verifier's own output, or null when the run did not complete. */
function readOutlayerOutput(text: string): unknown {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(raw) || raw.error != null) return null;
  if (typeof raw.status === 'string' && raw.status !== 'completed') return null;
  return raw.output ?? null;
}

function outlayerFailure(status: number): string {
  if (status === 401 || status === 402 || status === 403) return 'OutLayer refused the payment key of this server.';
  if (status === 429) return 'The verifier is busy. Try again in a moment.';
  if (status >= 400 && status < 500) return `OutLayer refused the call (${status}).`;
  return `The verifier failed (${status}). Try again.`;
}
