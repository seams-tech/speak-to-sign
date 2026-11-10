// OAuth 1.0a request signing (HMAC-SHA1) for the X API, with Web Crypto. This file exports no
// onRequest handler, so it is not a route.

export interface OAuth1Keys {
  consumerKey: string;
  consumerSecret: string;
  token: string;
  tokenSecret: string;
}

/** Percent-encoding of RFC 3986: only A-Z, a-z, 0-9, "-", ".", "_" and "~" stay as they are. */
export function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** A query string with RFC 3986 encoding, in the order given. */
export function queryString(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => `${rfc3986(key)}=${rfc3986(value)}`)
    .join('&');
}

/**
 * The `Authorization` header of a signed request. `url` has no query string: every query or
 * form parameter goes in `params`.
 */
export async function oauth1Header(
  method: string,
  url: string,
  params: Record<string, string>,
  keys: OAuth1Keys,
  nonce: string,
  timestampSeconds: number,
): Promise<string> {
  const oauth: Record<string, string> = {
    oauth_consumer_key: keys.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(timestampSeconds),
    oauth_token: keys.token,
    oauth_version: '1.0',
  };
  const pairs = Object.entries({ ...params, ...oauth })
    .map(([key, value]): [string, string] => [rfc3986(key), rfc3986(value)])
    .sort(([aKey, aValue], [bKey, bValue]) => (aKey === bKey ? compare(aValue, bValue) : compare(aKey, bKey)));
  const parameterString = pairs.map(([key, value]) => `${key}=${value}`).join('&');
  const base = [method.toUpperCase(), rfc3986(url), rfc3986(parameterString)].join('&');
  const signingKey = `${rfc3986(keys.consumerSecret)}&${rfc3986(keys.tokenSecret)}`;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(signingKey), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(base)));
  let binary = '';
  for (const byte of mac) binary += String.fromCharCode(byte);
  const signature = btoa(binary);

  const header = Object.entries({ ...oauth, oauth_signature: signature })
    .sort(([a], [b]) => compare(a, b))
    .map(([name, value]) => `${rfc3986(name)}="${rfc3986(value)}"`)
    .join(', ');
  return `OAuth ${header}`;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
