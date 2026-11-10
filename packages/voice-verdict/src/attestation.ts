/**
 * The OutLayer attestation of one verifier call: a TDX quote that binds the WASM that ran, the
 * input and the output of the call.
 *
 * Each HTTPS call of an OutLayer worker returns `attestation_url`. The record at that URL has a
 * TDX quote. The first 32 bytes of the quote's report data are the task hash: a SHA-256 over the
 * WASM hash, the input hash, the output hash, the caller, the project and the time. So the quote
 * says: this worker ran this WASM on this input and gave this output.
 *
 * `checkAttestationBinding` checks the links from the quote to the record, the output and the
 * WASM. Two checks are separate, and the result names them:
 * - the signature chain of the quote to Intel (`checkQuoteSignature`, or with Intel's
 *   collateral `checkQuoteCollateral`, in `dcap.ts`);
 * - the approval of the five measurements (`measurementsApproved` asks the NEAR contract).
 */

/** The record of `GET <api>/attestations/by-call/<call_id>`. Other fields are ignored. */
export interface AttestationRecord {
  task_type: string;
  task_id: number;
  /** Standard base64 of the TDX quote. */
  tdx_quote: string;
  /** Unix seconds. */
  timestamp: number;
  output_hash: string;
  input_hash?: string | null;
  repo_url?: string | null;
  commit_hash?: string | null;
  build_target?: string | null;
  wasm_hash?: string | null;
  block_height?: number | null;
  caller_account_id?: string | null;
  project_id?: string | null;
  secrets_ref?: string | null;
  attached_usd?: string | null;
  call_id?: string | null;
}

/** The five TDX measurements of a quote, each 48 bytes as lowercase hex. */
export interface Measurements {
  mrtd: string;
  rtmr0: string;
  rtmr1: string;
  rtmr2: string;
  rtmr3: string;
}

export type AttestationRefusal =
  /** The record is not an attestation record of an execution, or the quote is not a TDX quote. */
  | { code: 'malformed'; detail: string }
  /** The report data of the quote is not the task hash of the record. */
  | { code: 'task_hash_mismatch' }
  /** The record is for another output than the one that you hold. */
  | { code: 'output_mismatch' }
  /** The record is for another input than the one that you hold. */
  | { code: 'input_mismatch' }
  /** The WASM that ran is not one that you accept. */
  | { code: 'wasm_not_accepted'; wasmHash: string | null }
  /** The record is for another project or another caller. */
  | { code: 'project_mismatch' }
  | { code: 'caller_mismatch' };

export type AttestationCheck =
  | {
      ok: true;
      /** SHA-256 of the WASM that ran: the OutLayer version key. */
      wasmHash: string;
      /** The measurements of the quote. They mean nothing until they are approved. */
      measurements: Measurements;
      /** The raw quote, for `checkQuoteSignature` or `checkQuoteCollateral`. */
      quote: Uint8Array<ArrayBuffer>;
      /** The checks that this function did not do. */
      notChecked: ['quote_signature', 'measurements_approved'];
    }
  | { ok: false; refusal: AttestationRefusal };

export interface CheckAttestationInput {
  record: AttestationRecord;
  /** The `output` of the call, as OutLayer returned it (the parsed JSON value). */
  output: unknown;
  /** The WASM hashes that you accept: 64 lowercase hex characters each. Build the WASM to get one. */
  acceptedWasmHashes: readonly string[];
  /** The `input` that you sent, with its keys in the order that you sent them. Optional. */
  input?: unknown;
  /** The expected project, `owner/project`. Optional. */
  projectId?: string;
  /** The expected caller: over HTTPS, the owner of the payment key. Optional. */
  callerAccountId?: string;
}

/** Records before this time (2026-01-30) have the shorter task hash. This module refuses them. */
const V1_CUTOFF = 1_769_784_939;
const utf8 = new TextEncoder();

/**
 * Checks that the record binds this output (and this input, if you give it) to an accepted WASM,
 * and that the TDX quote commits to the record. It does not check the signature of the quote or
 * the approval of the measurements: see `notChecked`.
 */
export async function checkAttestationBinding(input: CheckAttestationInput): Promise<AttestationCheck> {
  const { record } = input;
  const refuse = (refusal: AttestationRefusal): AttestationCheck => ({ ok: false, refusal });
  const malformed = (detail: string) => refuse({ code: 'malformed', detail });
  if (typeof record !== 'object' || record === null) return malformed('record');
  if (record.task_type !== 'execute') return malformed('task_type');
  if (!Number.isSafeInteger(record.task_id) || !Number.isSafeInteger(record.timestamp)) return malformed('task_id');
  if (record.timestamp < V1_CUTOFF) return malformed('record before the current task hash format');
  if (!isHash(record.output_hash)) return malformed('output_hash');

  const parsed = parseTdxQuote(record.tdx_quote);
  if (parsed === null) return malformed('tdx_quote');

  // 1. The quote commits to the record.
  const expected = await taskHash(record);
  const zeroTail = parsed.reportData.subarray(32).every((byte) => byte === 0);
  if (!zeroTail || !sameBytes(parsed.reportData.subarray(0, 32), expected)) return refuse({ code: 'task_hash_mismatch' });

  // 2. The record is for this output: SHA-256 of the compact JSON with sorted keys.
  if ((await sha256Hex(sortedJson(input.output))) !== record.output_hash) return refuse({ code: 'output_mismatch' });

  // 3. The record is for this input: SHA-256 of the compact JSON in the order that was sent.
  if (input.input !== undefined && (await sha256Hex(JSON.stringify(input.input))) !== record.input_hash) {
    return refuse({ code: 'input_mismatch' });
  }

  // 4. The WASM, the project and the caller.
  const wasmHash = record.wasm_hash ?? null;
  if (wasmHash === null || !input.acceptedWasmHashes.includes(wasmHash)) return refuse({ code: 'wasm_not_accepted', wasmHash });
  if (input.projectId !== undefined && record.project_id !== input.projectId) return refuse({ code: 'project_mismatch' });
  if (input.callerAccountId !== undefined && record.caller_account_id !== input.callerAccountId) {
    return refuse({ code: 'caller_mismatch' });
  }
  return {
    ok: true,
    wasmHash,
    measurements: parsed.measurements,
    quote: parsed.quote,
    notChecked: ['quote_signature', 'measurements_approved'],
  };
}

/**
 * The task hash of a record, as `outlayer-verify` computes it (format V1). Text fields go in as
 * UTF-8, the hashes as their hex text, `task_id` and `timestamp` as 64-bit little-endian. An
 * absent field adds no bytes.
 */
export async function taskHash(record: AttestationRecord): Promise<Uint8Array<ArrayBuffer>> {
  const parts: Uint8Array[] = [utf8.encode(record.task_type), int64(record.task_id)];
  const text = (value: string | null | undefined) => {
    if (value != null) parts.push(utf8.encode(value));
  };
  for (const field of [record.repo_url, record.commit_hash, record.build_target, record.wasm_hash, record.input_hash]) {
    text(field);
  }
  text(record.output_hash);
  if (record.block_height != null) parts.push(int64(record.block_height));
  for (const field of [record.caller_account_id, record.project_id, record.secrets_ref]) text(field);
  parts.push(int64(record.timestamp));
  text(record.attached_usd);
  const preimage = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    preimage.set(part, at);
    at += part.length;
  }
  return new Uint8Array(await crypto.subtle.digest('SHA-256', preimage));
}

/** Reads the measurements and the report data of a TDX quote (version 4 or 5). `null` for other bytes. */
export function parseTdxQuote(
  quoteB64: string,
): { quote: Uint8Array<ArrayBuffer>; measurements: Measurements; reportData: Uint8Array } | null {
  let quote: Uint8Array<ArrayBuffer>;
  try {
    quote = Uint8Array.from(atob(quoteB64), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
  // Header: version (u16), attestation key type (u16), TEE type (u32, 0x81 for TDX), ... 48 bytes.
  if (quote.length < 48 + 584) return null;
  const view = new DataView(quote.buffer);
  const version = view.getUint16(0, true);
  if (view.getUint32(4, true) !== 0x81) return null;
  // Version 5 has a body type (u16: 2 for TDX 1.0, 3 for TDX 1.5) and a body size (u32) before
  // the TD report. The fields below have the same offsets in both reports.
  const bodyType = version === 5 ? view.getUint16(48, true) : 0;
  const body = version === 4 ? 48 : bodyType === 2 || bodyType === 3 ? 54 : -1;
  if (body < 0 || quote.length < body + 584) return null;
  const hex = (offset: number, length: number) => toHex(quote.subarray(body + offset, body + offset + length));
  return {
    quote,
    measurements: { mrtd: hex(136, 48), rtmr0: hex(328, 48), rtmr1: hex(376, 48), rtmr2: hex(424, 48), rtmr3: hex(472, 48) },
    reportData: quote.subarray(body + 520, body + 584),
  };
}

/** The OutLayer contract that holds the approved measurements. */
export const WORKER_CONTRACT = { testnet: 'worker.outlayer.testnet', mainnet: 'worker.outlayer.near' } as const;

/**
 * Asks the OutLayer worker contract on NEAR if it approves these measurements now
 * (`is_measurements_approved`). `rpcUrl` is a NEAR RPC of the same network. The answer is the
 * view of that RPC: this function checks no proof of it.
 */
export async function measurementsApproved(options: {
  rpcUrl: string;
  contract: string;
  measurements: Measurements;
  fetch?: typeof fetch;
}): Promise<boolean> {
  const args = btoa(JSON.stringify({ measurements: options.measurements }));
  const response = await (options.fetch ?? fetch)(options.rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'query',
      params: {
        request_type: 'call_function',
        finality: 'final',
        account_id: options.contract,
        method_name: 'is_measurements_approved',
        args_base64: args,
      },
    }),
  });
  const reply = (await response.json()) as { result?: { result?: number[] } };
  const bytes = reply.result?.result;
  if (!Array.isArray(bytes)) throw new Error('the NEAR RPC gave no view result');
  return new TextDecoder().decode(Uint8Array.from(bytes)) === 'true';
}

/** Fetches the record of `attestation_url` of a call. `baseUrl` is the OutLayer API. */
export async function fetchAttestation(
  baseUrl: string,
  attestationUrl: string,
  options: { fetch?: typeof fetch } = {},
): Promise<AttestationRecord> {
  if (!/^\/attestations\/by-call\/[0-9a-f-]{1,64}$/.test(attestationUrl)) throw new RangeError('not an attestation URL of a call');
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:') throw new RangeError('baseUrl must be an HTTPS URL');
  const response = await (options.fetch ?? fetch)(`${base.origin}${base.pathname.replace(/\/+$/, '')}${attestationUrl}`);
  if (!response.ok) throw new Error(`OutLayer gave no attestation (${response.status})`);
  return (await response.json()) as AttestationRecord;
}

/** Compact JSON with the keys of each object sorted, as the OutLayer worker hashes an output. */
function sortedJson(value: unknown): string {
  const sorted = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sorted);
    if (typeof item === 'object' && item !== null) {
      const record = item as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(record)
          .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
          .map((key) => [key, sorted(record[key])]),
      );
    }
    return item;
  };
  return JSON.stringify(sorted(value));
}

function int64(value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigInt64(0, BigInt(value), true);
  return bytes;
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

async function sha256Hex(text: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(text))));
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
