// The parts that the Pages Functions share: the same-origin rule, the bounded body, the JSON
// answer and the account check. This file exports no onRequest handler, so it is not a route.

/** The NEAR testnet RPC when NEAR_RPC_URL is not set. */
export const DEFAULT_RPC_URL = 'https://test.rpc.fastnear.com';

const ACCOUNT_ID = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

/** A NEAR account ID: named or implicit. */
export function isAccountId(value: unknown): value is string {
  return typeof value === 'string' && ACCOUNT_ID.test(value);
}

/** A 403 answer for a request from another site, or null. A request with no Origin header passes. */
export function refuseOtherOrigin(request: Request): Response | null {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: 'This route takes requests from this site only.' }, 403);
  }
  return null;
}

/** The body as text, or null when it is longer than `maximumBytes`. */
export async function readBoundedText(request: Request, maximumBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (Number.isFinite(declared) && declared > maximumBytes) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > maximumBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}
