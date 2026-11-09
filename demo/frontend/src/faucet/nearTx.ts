// A small NEAR transaction signer for the faucet's Pages Function: one function call, signed
// with an ed25519 key through WebCrypto, encoded with Borsh, sent over JSON-RPC. No NEAR
// library: the Workers runtime has WebCrypto and fetch. The browser never loads this file.

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Decode(text: string): Uint8Array {
  let value = 0n;
  for (const char of text) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) throw new Error('The key or hash is not base58.');
    value = value * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (value > 0n) {
    bytes.unshift(Number(value % 256n));
    value /= 256n;
  }
  for (const char of text) {
    if (char !== '1') break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

export function base58Encode(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let text = '';
  while (value > 0n) {
    text = ALPHABET[Number(value % 58n)] + text;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    text = '1' + text;
  }
  return text;
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Borsh writer for the parts of a transaction that the faucet needs. */
class Writer {
  private parts: number[] = [];
  u8(value: number) {
    this.parts.push(value & 0xff);
  }
  u32(value: number) {
    for (let i = 0; i < 4; i += 1) this.u8(value >>> (8 * i));
  }
  uint(value: bigint, bytes: number) {
    let rest = value;
    for (let i = 0; i < bytes; i += 1) {
      this.u8(Number(rest & 0xffn));
      rest >>= 8n;
    }
  }
  bytes(value: Uint8Array) {
    for (const byte of value) this.u8(byte);
  }
  vec(value: Uint8Array) {
    this.u32(value.length);
    this.bytes(value);
  }
  string(value: string) {
    this.vec(new TextEncoder().encode(value));
  }
  done(): Uint8Array<ArrayBuffer> {
    return Uint8Array.from(this.parts);
  }
}

export interface FunctionCall {
  methodName: string;
  args: unknown;
  gas: bigint;
  deposit: bigint;
}

interface Key {
  publicKey: Uint8Array;
  privateKey: CryptoKey;
  /** "ed25519:<base58>", as RPC wants it. */
  publicKeyText: string;
}

/** Reads a NEAR secret key ("ed25519:" + base58 of the 32-byte seed and the 32-byte public key). */
export async function importNearKey(secret: string): Promise<Key> {
  const raw = base58Decode(secret.replace(/^ed25519:/, ''));
  if (raw.length !== 64) throw new Error('The faucet key is not a 64-byte ed25519 secret key.');
  const seed = raw.slice(0, 32);
  const publicKey = raw.slice(32);
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    { kty: 'OKP', crv: 'Ed25519', d: base64Url(seed), x: base64Url(publicKey) },
    { name: 'Ed25519' },
    false,
    ['sign'],
  );
  return { publicKey, privateKey, publicKeyText: `ed25519:${base58Encode(publicKey)}` };
}

async function rpc<T>(rpcUrl: string, method: string, params: unknown): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'faucet', method, params }),
  });
  const body = (await response.json()) as { result?: T; error?: { cause?: { name?: string }; data?: unknown; message?: string } };
  if (body.error) {
    const detail = typeof body.error.data === 'string' ? body.error.data : JSON.stringify(body.error.data ?? body.error.cause ?? body.error.message);
    throw new Error(`NEAR RPC ${method}: ${detail}`);
  }
  return body.result as T;
}

/** Calls a view method and parses its JSON answer. */
export async function viewCall<T>(rpcUrl: string, accountId: string, methodName: string, args: unknown): Promise<T> {
  const result = await rpc<{ result: number[] }>(rpcUrl, 'query', {
    request_type: 'call_function',
    finality: 'final',
    account_id: accountId,
    method_name: methodName,
    args_base64: base64(new TextEncoder().encode(JSON.stringify(args))),
  });
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(result.result))) as T;
}

/** True when the account exists on the chain. */
export async function accountExists(rpcUrl: string, accountId: string): Promise<boolean> {
  try {
    await rpc(rpcUrl, 'query', { request_type: 'view_account', finality: 'final', account_id: accountId });
    return true;
  } catch {
    return false;
  }
}

export interface CallOutcome {
  transactionHash: string;
  /** The final value of the transaction (the last receipt's return value), parsed as JSON. */
  value: unknown;
  /** The panic message, when the transaction failed. */
  failure?: string;
}

/** Signs one function call from `signerId` to `receiverId` with `key`, sends it, and waits. */
export async function signAndSendCall(
  rpcUrl: string,
  signerId: string,
  receiverId: string,
  secretKey: string,
  call: FunctionCall,
): Promise<CallOutcome> {
  const key = await importNearKey(secretKey);
  const accessKey = await rpc<{ nonce: number; block_hash: string }>(rpcUrl, 'query', {
    request_type: 'view_access_key',
    finality: 'final',
    account_id: signerId,
    public_key: key.publicKeyText,
  });

  const tx = new Writer();
  tx.string(signerId);
  tx.u8(0);
  tx.bytes(key.publicKey);
  tx.uint(BigInt(accessKey.nonce) + 1n, 8);
  tx.string(receiverId);
  tx.bytes(base58Decode(accessKey.block_hash));
  tx.u32(1);
  tx.u8(2); // Action::FunctionCall
  tx.string(call.methodName);
  tx.vec(new TextEncoder().encode(JSON.stringify(call.args)));
  tx.uint(call.gas, 8);
  tx.uint(call.deposit, 16);
  const message = tx.done();

  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', message));
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, key.privateKey, hash));
  const signed = new Writer();
  signed.bytes(message);
  signed.u8(0);
  signed.bytes(signature);

  const outcome = await rpc<{
    status: { SuccessValue?: string; Failure?: unknown };
    transaction_outcome: { id: string };
  }>(rpcUrl, 'send_tx', { signed_tx_base64: base64(signed.done()), wait_until: 'EXECUTED_OPTIMISTIC' });

  const transactionHash = outcome.transaction_outcome.id ?? base58Encode(hash);
  if (outcome.status.Failure !== undefined) {
    return { transactionHash, value: null, failure: panicText(outcome.status.Failure) };
  }
  const encoded = outcome.status.SuccessValue ?? '';
  const text = encoded ? new TextDecoder().decode(Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))) : '';
  return { transactionHash, value: text ? (JSON.parse(text) as unknown) : null };
}

/** The panic message inside a NEAR failure object, or the object as JSON. */
function panicText(failure: unknown): string {
  const text = JSON.stringify(failure);
  const match = /"(?:ExecutionError|PanicMsg)"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text);
  const message = match?.[1] ?? text;
  return message.replace(/^Smart contract panicked: /, '');
}
