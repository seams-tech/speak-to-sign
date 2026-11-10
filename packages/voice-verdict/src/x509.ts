/**
 * A small DER reader for the Intel DCAP check: the X.509 certificates of a PCK chain, the CRLs
 * of the collateral and ECDSA P-256 signatures. It reads only what that check needs, and it
 * throws `DerError` for bytes that it cannot read. Not part of the public API.
 */

export type Bytes = Uint8Array<ArrayBuffer>;

export class DerError extends Error {}

/** One DER element: its tag, its contents and its complete encoding. */
export interface Element {
  tag: number;
  value: Bytes;
  raw: Bytes;
}

const TAG = {
  boolean: 0x01,
  integer: 0x02,
  bitString: 0x03,
  octetString: 0x04,
  oid: 0x06,
  enumerated: 0x0a,
  utcTime: 0x17,
  generalizedTime: 0x18,
  sequence: 0x30,
} as const;

export const OID = {
  ecdsaWithSha256: '1.2.840.10045.4.3.2',
  ecPublicKey: '1.2.840.10045.2.1',
  p256: '1.2.840.10045.3.1.7',
  basicConstraints: '2.5.29.19',
  sgxExtension: '1.2.840.113741.1.13.1',
  sgxTcb: '1.2.840.113741.1.13.1.2',
  sgxPceSvn: '1.2.840.113741.1.13.1.2.17',
  sgxCpuSvn: '1.2.840.113741.1.13.1.2.18',
  sgxPceId: '1.2.840.113741.1.13.1.3',
  sgxFmspc: '1.2.840.113741.1.13.1.4',
} as const;

/** Reads one element at `at`. */
function readElement(bytes: Bytes, at: number, end: number): Element {
  if (at + 2 > end) throw new DerError('truncated element');
  const tag = bytes[at]!;
  if ((tag & 0x1f) === 0x1f) throw new DerError('high tag number');
  let length = bytes[at + 1]!;
  let header = 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    if (count === 0 || count > 3) throw new DerError('unsupported length');
    if (at + 2 + count > end) throw new DerError('truncated length');
    length = 0;
    for (let index = 0; index < count; index += 1) length = length * 256 + bytes[at + 2 + index]!;
    header += count;
  }
  if (at + header + length > end) throw new DerError('truncated value');
  return {
    tag,
    value: bytes.subarray(at + header, at + header + length),
    raw: bytes.subarray(at, at + header + length),
  };
}

/** Reads exactly one element that fills `bytes`. */
export function parseDer(bytes: Bytes): Element {
  const element = readElement(bytes, 0, bytes.length);
  if (element.raw.length !== bytes.length) throw new DerError('trailing bytes');
  return element;
}

/** The elements inside a constructed element. */
export function children(element: Element): Element[] {
  if ((element.tag & 0x20) === 0) throw new DerError('not a constructed element');
  const out: Element[] = [];
  let at = 0;
  while (at < element.value.length) {
    const child = readElement(element.value, at, element.value.length);
    out.push(child);
    at += child.raw.length;
  }
  return out;
}

function expect(element: Element | undefined, tag: number, what: string): Element {
  if (element === undefined || element.tag !== tag) throw new DerError(`expected ${what}`);
  return element;
}

export function oidText(element: Element): string {
  const bytes = expect(element, TAG.oid, 'an object identifier').value;
  if (bytes.length === 0) throw new DerError('empty object identifier');
  const parts: number[] = [];
  let value = 0;
  for (const byte of bytes) {
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) {
      if (parts.length === 0) parts.push(value < 80 ? Math.floor(value / 40) : 2, value < 80 ? value % 40 : value - 80);
      else parts.push(value);
      value = 0;
    }
  }
  return parts.join('.');
}

/** The value of a non-negative INTEGER as bytes, with no leading zero byte. */
function integerBytes(element: Element): Bytes {
  const bytes = expect(element, TAG.integer, 'an integer').value;
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start += 1;
  return bytes.subarray(start);
}

function timeMs(element: Element): number {
  const text = new TextDecoder().decode(element.value);
  let match: RegExpMatchArray | null;
  if (element.tag === TAG.utcTime && (match = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text))) {
    const year = Number(match[1]);
    return Date.UTC(year < 50 ? 2000 + year : 1900 + year, Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]));
  }
  if (element.tag === TAG.generalizedTime && (match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text))) {
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]));
  }
  throw new DerError('bad time');
}

function algorithm(element: Element | undefined): string {
  const [oid] = children(expect(element, TAG.sequence, 'an algorithm'));
  return oidText(expect(oid, TAG.oid, 'an algorithm identifier'));
}

/** The contents of a BIT STRING with no unused bits. */
function bitString(element: Element | undefined): Bytes {
  const bytes = expect(element, TAG.bitString, 'a bit string').value;
  if (bytes[0] !== 0) throw new DerError('bit string with unused bits');
  return bytes.subarray(1);
}

export interface Certificate {
  raw: Bytes;
  /** The signed part. */
  tbs: Bytes;
  serial: string;
  issuer: Bytes;
  subject: Bytes;
  notBeforeMs: number;
  notAfterMs: number;
  /** The SubjectPublicKeyInfo, for Web Crypto. */
  spki: Bytes;
  signatureAlgorithm: string;
  /** DER `Ecdsa-Sig-Value`. */
  signature: Bytes;
  /** `cA` of the basic constraints. False if the certificate has none. */
  isCa: boolean;
  /** The contents of each extension's OCTET STRING, by object identifier. */
  extensions: Map<string, Bytes>;
}

export function parseCertificate(der: Bytes): Certificate {
  const [tbsElement, signatureAlgorithm, signature] = children(expect(parseDer(der), TAG.sequence, 'a certificate'));
  const tbs = expect(tbsElement, TAG.sequence, 'a TBS certificate');
  const fields = children(tbs);
  let at = 0;
  if (fields[0]?.tag === 0xa0) at += 1; // [0] version
  const serial = integerBytes(fields[at]!);
  const innerAlgorithm = algorithm(fields[at + 1]);
  const issuer = expect(fields[at + 2], TAG.sequence, 'an issuer');
  const [notBefore, notAfter] = children(expect(fields[at + 3], TAG.sequence, 'a validity'));
  const subject = expect(fields[at + 4], TAG.sequence, 'a subject');
  const spki = expect(fields[at + 5], TAG.sequence, 'a public key');
  const [keyAlgorithm] = children(spki);
  const [keyType, curve] = children(expect(keyAlgorithm, TAG.sequence, 'a key algorithm'));
  if (oidText(keyType!) !== OID.ecPublicKey || curve === undefined || oidText(curve) !== OID.p256) {
    throw new DerError('the key is not ECDSA P-256');
  }
  const outerAlgorithm = algorithm(signatureAlgorithm);
  if (outerAlgorithm !== innerAlgorithm) throw new DerError('two signature algorithms');

  const extensions = new Map<string, Bytes>();
  for (const field of fields.slice(at + 6)) {
    if (field.tag !== 0xa3) continue; // [1] and [2] unique ids
    for (const extension of children(expect(children(field)[0], TAG.sequence, 'extensions'))) {
      const parts = children(expect(extension, TAG.sequence, 'an extension'));
      const value = parts[parts.length - 1];
      extensions.set(oidText(parts[0]!), expect(value, TAG.octetString, 'an extension value').value);
    }
  }
  let isCa = false;
  const constraints = extensions.get(OID.basicConstraints);
  if (constraints !== undefined) {
    const [flag] = children(expect(parseDer(constraints), TAG.sequence, 'basic constraints'));
    isCa = flag?.tag === TAG.boolean && flag.value[0] !== 0;
  }
  return {
    raw: der,
    tbs: tbs.raw,
    serial: toHex(serial),
    issuer: issuer.raw,
    subject: subject.raw,
    notBeforeMs: timeMs(notBefore!),
    notAfterMs: timeMs(notAfter!),
    spki: spki.raw,
    signatureAlgorithm: outerAlgorithm,
    signature: bitString(signature),
    isCa,
    extensions,
  };
}

export interface Crl {
  tbs: Bytes;
  issuer: Bytes;
  thisUpdateMs: number;
  nextUpdateMs: number;
  /** The serial numbers of the revoked certificates, as lowercase hex. */
  revoked: Set<string>;
  signatureAlgorithm: string;
  signature: Bytes;
}

export function parseCrl(der: Bytes): Crl {
  const [tbsElement, signatureAlgorithm, signature] = children(expect(parseDer(der), TAG.sequence, 'a CRL'));
  const tbs = expect(tbsElement, TAG.sequence, 'a TBS CRL');
  const fields = children(tbs);
  let at = 0;
  if (fields[0]?.tag === TAG.integer) at += 1; // version
  const innerAlgorithm = algorithm(fields[at]);
  const issuer = expect(fields[at + 1], TAG.sequence, 'an issuer');
  const thisUpdate = timeMs(fields[at + 2]!);
  const next = fields[at + 3];
  if (next === undefined || (next.tag !== TAG.utcTime && next.tag !== TAG.generalizedTime)) {
    throw new DerError('a CRL with no next update');
  }
  const revoked = new Set<string>();
  const list = fields[at + 4];
  if (list?.tag === TAG.sequence) {
    for (const entry of children(list)) revoked.add(toHex(integerBytes(children(entry)[0]!)));
  }
  const outerAlgorithm = algorithm(signatureAlgorithm);
  if (outerAlgorithm !== innerAlgorithm) throw new DerError('two signature algorithms');
  return {
    tbs: tbs.raw,
    issuer: issuer.raw,
    thisUpdateMs: thisUpdate,
    nextUpdateMs: timeMs(next),
    revoked,
    signatureAlgorithm: outerAlgorithm,
    signature: bitString(signature),
  };
}

/** The platform values in the Intel SGX extension of a PCK certificate. */
export interface PckExtension {
  /** 6 bytes. */
  fmspc: Bytes;
  /** 2 bytes. */
  pceId: Bytes;
  /** 16 bytes: the SGX TCB components. */
  cpuSvn: Bytes;
  pceSvn: number;
}

export function pckExtension(certificate: Certificate): PckExtension {
  const extension = certificate.extensions.get(OID.sgxExtension);
  if (extension === undefined) throw new DerError('no Intel SGX extension');
  const entries = (element: Element) =>
    new Map(
      children(expect(element, TAG.sequence, 'an SGX sequence')).map((entry) => {
        const [oid, value] = children(expect(entry, TAG.sequence, 'an SGX entry'));
        return [oidText(oid!), value!] as const;
      }),
    );
  const top = entries(parseDer(extension));
  const tcbElement = top.get(OID.sgxTcb);
  if (tcbElement === undefined) throw new DerError('no TCB in the SGX extension');
  const tcb = entries(tcbElement);
  const octets = (value: Element | undefined, length: number, what: string) => {
    const bytes = expect(value, TAG.octetString, what).value;
    if (bytes.length !== length) throw new DerError(`${what} length`);
    return bytes;
  };
  const pceSvn = integerBytes(expect(tcb.get(OID.sgxPceSvn), TAG.integer, 'the PCE SVN'));
  if (pceSvn.length > 2) throw new DerError('PCE SVN length');
  return {
    fmspc: octets(top.get(OID.sgxFmspc), 6, 'the FMSPC'),
    pceId: octets(top.get(OID.sgxPceId), 2, 'the PCE ID'),
    cpuSvn: octets(tcb.get(OID.sgxCpuSvn), 16, 'the CPU SVN'),
    pceSvn: pceSvn.reduce((total, byte) => total * 256 + byte, 0),
  };
}

/** The DER certificates of a PEM text, in order. */
export function pemCertificates(text: string): Bytes[] {
  const blocks = text.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
  return blocks.map((block) => {
    const body = block.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');
    try {
      return Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
    } catch {
      throw new DerError('bad base64 in PEM');
    }
  });
}

/** DER `Ecdsa-Sig-Value` to the 64 bytes `r || s` that Web Crypto takes. */
export function rawSignature(der: Bytes): Bytes {
  const [r, s] = children(expect(parseDer(der), TAG.sequence, 'a signature'));
  const out = new Uint8Array(64);
  for (const [index, part] of [r, s].entries()) {
    const bytes = integerBytes(expect(part, TAG.integer, 'a signature integer'));
    if (bytes.length > 32) throw new DerError('signature integer too long');
    out.set(bytes, index * 32 + 32 - bytes.length);
  }
  return out;
}

/** Verifies an ECDSA P-256 SHA-256 signature (64 bytes `r || s`) with a SubjectPublicKeyInfo. */
export async function verifySpki(spki: Bytes, signature: Bytes, data: Bytes): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, data);
  } catch {
    return false;
  }
}

/** Verifies an ECDSA P-256 SHA-256 signature with a raw public key (64 bytes `x || y`). */
export async function verifyRawKey(key: Bytes, signature: Bytes, data: Bytes): Promise<boolean> {
  const point = new Uint8Array(65);
  point[0] = 0x04;
  point.set(key, 1);
  try {
    const imported = await crypto.subtle.importKey('raw', point, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, imported, signature, data);
  } catch {
    return false;
  }
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}
