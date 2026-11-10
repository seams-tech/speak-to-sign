/**
 * The Intel DCAP check of a TDX quote, with Web Crypto only (ECDSA P-256 and SHA-256).
 *
 * `checkQuoteSignature` needs only the quote: it checks that an Intel TDX platform signed the
 * quote, through the certificate chain in the quote to Intel's SGX root CA, which this module
 * pins. `checkQuoteCollateral` adds Intel's collateral for the platform: the CRLs, the TCB info
 * and the QE identity. Then it gives the TCB status of the platform, as `dcap-qvl` (the library
 * of `outlayer-verify`) does.
 *
 * The layout of the quote is the one of the Intel TDX DCAP Quoting Library API (quote versions
 * 4 and 5, attestation key type 2, certification data type 6 with a nested type 5 PEM chain).
 */

import {
  DerError,
  OID,
  parseCertificate,
  parseCrl,
  pckExtension,
  pemCertificates,
  rawSignature,
  sameBytes,
  toHex,
  verifyRawKey,
  verifySpki,
  type Bytes,
  type Certificate,
  type Crl,
} from './x509.ts';

/**
 * Intel SGX Root CA (CN=Intel SGX Root CA, O=Intel Corporation; valid 2018-05-21 to 2049-12-31),
 * DER as base64. The source is Intel's published copy:
 * https://certificates.trustedservices.intel.com/Intel_SGX_Provisioning_Certification_RootCA.cer
 * Its SHA-256 is `INTEL_SGX_ROOT_CA_SHA256`. The same file is in `dcap-qvl` 0.5.2
 * (`src/TrustedRootCA.der`) and in `outlayer-verify`
 * (`crates/verify-core/src/Intel_SGX_Provisioning_Certification_RootCA.der`).
 */
const INTEL_SGX_ROOT_CA_B64 =
  'MIICjzCCAjSgAwIBAgIUImUM1lqdNInzg7SVUr9QGzknBqwwCgYIKoZIzj0EAwIwaDEaMBgGA1UEAwwRSW50ZWwgU0dYIFJv' +
  'b3QgQ0ExGjAYBgNVBAoMEUludGVsIENvcnBvcmF0aW9uMRQwEgYDVQQHDAtTYW50YSBDbGFyYTELMAkGA1UECAwCQ0ExCzAJ' +
  'BgNVBAYTAlVTMB4XDTE4MDUyMTEwNDUxMFoXDTQ5MTIzMTIzNTk1OVowaDEaMBgGA1UEAwwRSW50ZWwgU0dYIFJvb3QgQ0Ex' +
  'GjAYBgNVBAoMEUludGVsIENvcnBvcmF0aW9uMRQwEgYDVQQHDAtTYW50YSBDbGFyYTELMAkGA1UECAwCQ0ExCzAJBgNVBAYT' +
  'AlVTMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEC6nEwMDIYZOj/iPWsCzaEKi71OiOSLRFhWGjbnBVJfVnkY4u3IjkDYYL' +
  '0MxO4mqsyYjlBalTVYxFP2sJBK5zlKOBuzCBuDAfBgNVHSMEGDAWgBQiZQzWWp00ifODtJVSv1AbOScGrDBSBgNVHR8ESzBJ' +
  'MEegRaBDhkFodHRwczovL2NlcnRpZmljYXRlcy50cnVzdGVkc2VydmljZXMuaW50ZWwuY29tL0ludGVsU0dYUm9vdENBLmRl' +
  'cjAdBgNVHQ4EFgQUImUM1lqdNInzg7SVUr9QGzknBqwwDgYDVR0PAQH/BAQDAgEGMBIGA1UdEwEB/wQIMAYBAf8CAQEwCgYI' +
  'KoZIzj0EAwIDSQAwRgIhAOW/5QkR+S9CiSDcNoowLuPRLsWGf/Yi7GSX94BgwTwgAiEA4J0lrHoMs+Xo5o/sX6O9QWxHRAvZ' +
  'UGOdRQ7cvqRXaqI=';

/** SHA-256 of the DER of the pinned Intel SGX Root CA. Compare it with Intel's published file. */
export const INTEL_SGX_ROOT_CA_SHA256 = '44a0196b2b99f889b8e149e95b807a350e7424964399e885a7cbb8ccfab674d3';

const ROOT_DER: Bytes = Uint8Array.from(atob(INTEL_SGX_ROOT_CA_B64), (char) => char.charCodeAt(0));
const ROOT: Certificate = parseCertificate(ROOT_DER);
const INTEL_QE_VENDOR_ID = '939a7233f79c4ca9940a0db3957f0607';
const TEE_TDX = 0x81;

export type QuoteSignatureRefusal =
  /** The bytes are not a TDX quote (version 4 or 5) with an ECDSA P-256 key of the Intel QE. */
  | { code: 'malformed_quote'; detail: string }
  /** The attestation key did not sign the header and the TD report. */
  | { code: 'bad_quote_signature'; detail: string }
  /** The QE report does not commit to the attestation key and the QE authentication data. */
  | { code: 'qe_report_data_mismatch'; detail: string }
  /** A certificate of the PCK chain cannot be read, or it is not ECDSA P-256 with SHA-256. */
  | { code: 'malformed_certificate'; detail: string }
  /** The PCK certificate did not sign the QE report. */
  | { code: 'bad_qe_report_signature'; detail: string }
  /** The names or the CA flags of the chain do not link. */
  | { code: 'bad_certificate_chain'; detail: string }
  /** A certificate of the chain is not signed by the next one, or the last by the Intel root. */
  | { code: 'bad_certificate_signature'; detail: string }
  /** The chain ends at a root that is not the pinned Intel SGX Root CA. */
  | { code: 'untrusted_root'; detail: string }
  /** A certificate of the chain is not valid at `nowMs`. */
  | { code: 'certificate_not_yet_valid'; detail: string }
  | { code: 'certificate_expired'; detail: string };

/** The checks that `checkQuoteSignature` does not do. `checkQuoteCollateral` does them. */
export type QuoteNotChecked = 'tcb_status' | 'qe_identity' | 'revocation' | 'td_attributes';

export type QuoteSignatureCheck =
  | {
      ok: true;
      /** The platform id of the PCK certificate, 12 lowercase hex characters. Use it to get the collateral. */
      fmspc: string;
      /** The checks that this function did not do. */
      notChecked: QuoteNotChecked[];
    }
  | { ok: false; refusal: QuoteSignatureRefusal };

export interface CheckQuoteSignatureInput {
  /** The quote: its bytes, or standard base64 (the `tdx_quote` of an attestation record). */
  quote: Uint8Array | string;
  /** The time for the validity of the certificates. Default: `Date.now()`. */
  nowMs?: number;
}

/**
 * Checks, in this order, with Intel's root as the only trust anchor:
 * 1. the bytes are a TDX quote, version 4 or 5;
 * 2. the attestation key of the quote signed the header and the TD report;
 * 3. the QE report data is SHA-256(attestation key || QE authentication data), then 32 zero bytes;
 * 4. the PCK certificate of the quote signed the QE report;
 * 5. each certificate of the chain is signed by the next one, and the last by the Intel root;
 * 6. a root in the chain is the pinned Intel SGX Root CA;
 * 7. each certificate is valid at `nowMs`.
 * It does not throw for a bad quote.
 */
export async function checkQuoteSignature(input: CheckQuoteSignatureInput): Promise<QuoteSignatureCheck> {
  const result = await signedQuote(input.quote, seconds(input.nowMs));
  if (!result.ok) return result;
  return { ok: true, fmspc: toHex(result.pck.fmspc), notChecked: ['tcb_status', 'qe_identity', 'revocation', 'td_attributes'] };
}

/**
 * Intel's collateral for one platform, in the JSON format of `dcap-qvl` (`QuoteCollateralV3`).
 * The CRLs and the signatures are hex, the chains are PEM, `tcb_info` and `qe_identity` are the
 * JSON text that Intel signed.
 */
export interface QuoteCollateral {
  /** Ignored: the check uses the PCK chain in the quote. */
  pck_certificate_chain?: string;
  pck_crl_issuer_chain: string;
  root_ca_crl: string;
  pck_crl: string;
  tcb_info_issuer_chain: string;
  tcb_info: string;
  tcb_info_signature: string;
  qe_identity_issuer_chain: string;
  qe_identity: string;
  qe_identity_signature: string;
}

export type TcbStatus =
  | 'UpToDate'
  | 'SWHardeningNeeded'
  | 'ConfigurationNeeded'
  | 'ConfigurationAndSWHardeningNeeded'
  | 'OutOfDate'
  | 'OutOfDateConfigurationNeeded'
  | 'Revoked';

/** From the best to the worst, as `dcap-qvl` merges them. */
const SEVERITY: readonly TcbStatus[] = [
  'UpToDate',
  'SWHardeningNeeded',
  'ConfigurationNeeded',
  'ConfigurationAndSWHardeningNeeded',
  'OutOfDate',
  'OutOfDateConfigurationNeeded',
  'Revoked',
];

export type QuoteCollateralRefusal =
  | QuoteSignatureRefusal
  /** The collateral cannot be read. */
  | { code: 'malformed_collateral'; detail: string }
  /** A CRL is not signed by the issuer of the certificates that it lists. */
  | { code: 'bad_crl_signature'; detail: string }
  /** A CRL has its next update at or before `nowMs`. */
  | { code: 'crl_expired'; detail: string }
  /** No CRL of the collateral is from the issuer of a certificate. */
  | { code: 'revocation_unknown'; detail: string }
  /** A CRL lists a certificate of a chain. */
  | { code: 'certificate_revoked'; detail: string }
  /** The TCB info or the QE identity is not signed by its Intel signing certificate. */
  | { code: 'bad_collateral_signature'; detail: string }
  /** The TCB info or the QE identity is not valid at `nowMs`. */
  | { code: 'collateral_not_yet_valid'; detail: string }
  | { code: 'collateral_expired'; detail: string }
  /** The collateral is for another platform or another TEE type. */
  | { code: 'collateral_mismatch'; detail: string }
  /** The QE report does not match the QE identity (signer, product, attributes, SVN). */
  | { code: 'qe_identity_mismatch'; detail: string }
  /** The TDX module of the TD report does not match the TCB info. */
  | { code: 'tdx_module_mismatch'; detail: string }
  /** No TCB level of the TCB info is at or below the platform. */
  | { code: 'tcb_level_not_found'; detail: string }
  /** Intel revoked the TCB level of the platform. */
  | { code: 'tcb_revoked'; detail: string }
  /** The TD runs in debug mode, has reserved attribute bits, has no SEPT_VE_DISABLE, or is a service TD. */
  | { code: 'bad_td_attributes'; detail: string };

export type QuoteCollateralCheck =
  | {
      ok: true;
      fmspc: string;
      /**
       * The merged status of the platform, the TDX module and the QE. Only `Revoked` is a
       * refusal: you decide if you accept `OutOfDate` and the other statuses.
       */
      tcbStatus: TcbStatus;
      /** The Intel security advisories of that status, such as `INTEL-SA-01245`. */
      advisoryIds: string[];
      notChecked: [];
    }
  | { ok: false; refusal: QuoteCollateralRefusal };

export interface CheckQuoteCollateralInput extends CheckQuoteSignatureInput {
  collateral: QuoteCollateral;
}

/**
 * The full DCAP check of `dcap-qvl`: all of `checkQuoteSignature`, then the collateral. Pass the
 * time when the quote was made as `nowMs` (for an OutLayer record: `timestamp * 1000`), and the
 * collateral that was valid at that time (`fetchCollateral`). Collateral is valid for about 30
 * days, so a check of an old quote with today's collateral fails.
 */
export async function checkQuoteCollateral(input: CheckQuoteCollateralInput): Promise<QuoteCollateralCheck> {
  const nowSec = seconds(input.nowMs);
  const signed = await signedQuote(input.quote, nowSec);
  if (!signed.ok) return signed;
  const { quote, path, pck } = signed;
  const refuse = (code: Exclude<QuoteCollateralRefusal['code'], QuoteSignatureRefusal['code']>, detail: string): QuoteCollateralCheck => ({
    ok: false,
    refusal: { code, detail },
  });

  // The collateral, as text.
  let collateral: ParsedCollateral;
  try {
    collateral = parseCollateral(input.collateral);
  } catch (error) {
    return refuse('malformed_collateral', message(error));
  }

  // The order of dcap-qvl: the root against its CRL, the TCB info, the QE identity, then the
  // PCK chain against the CRLs.
  const crls = [collateral.rootCrl, collateral.pckCrl];
  const rootRevocation = await revocation([], ROOT, crls, nowSec);
  if (rootRevocation) return rootRevocation;

  // The TCB info and the QE identity: valid now, and signed by an Intel signing certificate.
  for (const document of [collateral.tcbInfo, collateral.qeIdentity]) {
    if (nowSec < document.issueSec) return refuse('collateral_not_yet_valid', `${document.name}: the issue date is after nowMs`);
    if (nowSec > document.nextUpdateSec) return refuse('collateral_expired', `${document.name}: the next update is before nowMs`);
    const chain = await checkChain(document.chain, nowSec);
    if (!chain.ok) return chain;
    const revoked = await revocation(chain.path, ROOT, crls, nowSec);
    if (revoked) return revoked;
    if (!(await verifySpki(chain.path[0]!.spki, document.signature, document.signed))) {
      return refuse('bad_collateral_signature', document.name);
    }
  }
  const pckRevocation = await revocation(path, ROOT, crls, nowSec);
  if (pckRevocation) return pckRevocation;
  const tcbInfo = collateral.tcbInfo.value;
  const qeIdentity = collateral.qeIdentity.value;
  if (tcbInfo.id !== 'TDX' || tcbInfo.version < 3) return refuse('collateral_mismatch', 'the TCB info is not for TDX');
  if (qeIdentity.id !== 'TD_QE' || ![2, 3].includes(qeIdentity.version)) {
    return refuse('collateral_mismatch', 'the QE identity is not for the TD QE');
  }

  // The QE report against the QE identity.
  const qe = quote.qeReport;
  const qeBytes = (offset: number, length: number) => qe.subarray(offset, offset + length);
  if (!sameBytes(qeBytes(128, 32), qeIdentity.mrsigner)) return refuse('qe_identity_mismatch', 'MRSIGNER');
  if ((qe[48]! & 0x02) !== 0) return refuse('qe_identity_mismatch', 'the QE runs in debug mode');
  if (u16(qe, 256) !== qeIdentity.isvprodid) return refuse('qe_identity_mismatch', 'ISVPRODID');
  if (!sameMasked(qeBytes(16, 4), qeIdentity.miscselect, qeIdentity.miscselectMask)) return refuse('qe_identity_mismatch', 'MISCSELECT');
  if (!sameMasked(qeBytes(48, 16), qeIdentity.attributes, qeIdentity.attributesMask)) return refuse('qe_identity_mismatch', 'ATTRIBUTES');
  const qeSvn = u16(qe, 256 + 2);
  const qeLevel = qeIdentity.tcbLevels.find((level) => qeSvn >= level.isvsvn);
  if (qeLevel === undefined) return refuse('qe_identity_mismatch', `the QE ISVSVN ${qeSvn} is below every TCB level`);

  // The platform: FMSPC, PCE ID, then the first TCB level that the platform reaches.
  if (toHex(pck.fmspc) !== tcbInfo.fmspc.toLowerCase()) return refuse('collateral_mismatch', 'FMSPC');
  if (toHex(pck.pceId) !== tcbInfo.pceId.toLowerCase()) return refuse('collateral_mismatch', 'PCE ID');
  const teeTcbSvn = quote.report.subarray(0, 16);
  let platform: Status | undefined;
  for (const level of tcbInfo.tcbLevels) {
    if (level.sgx.length !== 16 || level.tdx.length !== 16) return refuse('malformed_collateral', 'a TCB level without 16 components');
    if (pck.pceSvn < level.pcesvn) continue;
    if (level.sgx.some((svn, index) => pck.cpuSvn[index]! < svn)) continue;
    if (level.tdx.some((svn, index) => teeTcbSvn[index]! < svn)) continue;
    platform = { status: level.status, advisoryIds: level.advisoryIds };
    break;
  }
  if (platform === undefined) return refuse('tcb_level_not_found', 'no TCB level matches the platform');

  // The TDX module: its signer and attributes, and the TCB level of its version.
  const module = tdxModuleStatus(tcbInfo, quote.report);
  if (typeof module === 'string') return refuse('tdx_module_mismatch', module);

  let merged = platform;
  if (module !== null) merged = merge(merged, module);
  merged = merge(merged, { status: qeLevel.status, advisoryIds: qeLevel.advisoryIds });
  if (merged.status === 'Revoked') return refuse('tcb_revoked', 'Intel revoked the TCB level of this platform');

  // The attributes of the TD.
  const attributes = tdAttributesProblem(quote);
  if (attributes) return refuse('bad_td_attributes', attributes);

  return { ok: true, fmspc: toHex(pck.fmspc), tcbStatus: merged.status, advisoryIds: merged.advisoryIds, notChecked: [] };
}

/** The reply of `GET <OutLayer API>/public/collateral`. */
export interface CollateralRecord {
  collateral: QuoteCollateral;
  fmspc: string;
  /** True if the collateral is valid at the time that you asked for. */
  coversRequestedTime: boolean;
  validFrom: string;
  validUntil: string;
  /** The NEAR contract that holds this collateral, such as `worker.outlayer.testnet`. */
  contractId: string;
  collateralSha256: string;
  blockHeight: number | null;
}

/**
 * Fetches the Intel collateral that OutLayer keeps on NEAR for one platform at one time
 * (`GET <baseUrl>/public/collateral?fmspc=<fmspc>&at=<unix seconds>`). Intel signed its content,
 * so the server cannot change the result of `checkQuoteCollateral`: it can only make it fail.
 */
export async function fetchCollateral(options: {
  baseUrl: string;
  fmspc: string;
  atMs: number;
  fetch?: typeof fetch;
}): Promise<CollateralRecord> {
  if (!/^[0-9a-f]{12}$/i.test(options.fmspc)) throw new RangeError('fmspc must be 12 hex characters');
  const base = new URL(options.baseUrl);
  if (base.protocol !== 'https:') throw new RangeError('baseUrl must be an HTTPS URL');
  const at = Math.floor(options.atMs / 1000);
  const url = `${base.origin}${base.pathname.replace(/\/+$/, '')}/public/collateral?fmspc=${options.fmspc.toLowerCase()}&at=${at}`;
  const response = await (options.fetch ?? fetch)(url);
  if (!response.ok) throw new Error(`OutLayer gave no collateral (${response.status})`);
  const reply = (await response.json()) as Record<string, unknown>;
  if (typeof reply.collateral !== 'string') throw new Error('the reply has no collateral');
  return {
    collateral: JSON.parse(reply.collateral) as QuoteCollateral,
    fmspc: String(reply.fmspc ?? ''),
    coversRequestedTime: reply.covers_requested_time === true,
    validFrom: String(reply.valid_from ?? ''),
    validUntil: String(reply.valid_until ?? ''),
    contractId: String(reply.contract_id ?? ''),
    collateralSha256: String(reply.collateral_sha256 ?? ''),
    blockHeight: typeof reply.block_height === 'number' ? reply.block_height : null,
  };
}

// ---------------------------------------------------------------------------------------------
// The quote.

interface DcapQuote {
  /** The header and the body: the bytes that the attestation key signs. */
  signed: Bytes;
  /** The TD report: 584 bytes (TDX 1.0) or 648 bytes (TDX 1.5). */
  report: Bytes;
  signature: Bytes;
  attestationKey: Bytes;
  qeReport: Bytes;
  qeReportSignature: Bytes;
  qeAuthData: Bytes;
  pckChain: string;
}

function parseDcapQuote(bytes: Bytes): DcapQuote {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  const take = (length: number, what: string): Bytes => {
    if (at + length > bytes.length) throw new DerError(`the quote ends in ${what}`);
    const part = bytes.subarray(at, at + length);
    at += length;
    return part;
  };
  const u16At = (what: string) => {
    take(2, what);
    return view.getUint16(at - 2, true);
  };
  const u32At = (what: string) => {
    take(4, what);
    return view.getUint32(at - 4, true);
  };

  const header = take(48, 'the header');
  const version = view.getUint16(0, true);
  if (version !== 4 && version !== 5) throw new DerError(`quote version ${version}`);
  if (view.getUint16(2, true) !== 2) throw new DerError('the attestation key is not ECDSA P-256');
  if (view.getUint32(4, true) !== TEE_TDX) throw new DerError('not a TDX quote');
  if (toHex(header.subarray(12, 28)) !== INTEL_QE_VENDOR_ID) throw new DerError('not the Intel QE');
  let reportLength = 584;
  if (version === 5) {
    const bodyType = u16At('the body type');
    const bodySize = u32At('the body size');
    if (bodyType === 3) reportLength = 648;
    else if (bodyType !== 2) throw new DerError(`body type ${bodyType}`);
    if (bodySize !== reportLength) throw new DerError('the body size');
  }
  const report = take(reportLength, 'the TD report');
  const signed = bytes.subarray(0, at);

  const signatureDataLength = u32At('the signature data length');
  const signatureDataEnd = at + signatureDataLength;
  if (signatureDataEnd > bytes.length) throw new DerError('the quote ends in the signature data');
  const signature = take(64, 'the quote signature');
  const attestationKey = take(64, 'the attestation key');
  if (u16At('the certification data type') !== 6) throw new DerError('the certification data is not QE report data');
  const outerSize = u32At('the certification data size');
  const outerEnd = at + outerSize;
  const qeReport = take(384, 'the QE report');
  const qeReportSignature = take(64, 'the QE report signature');
  const qeAuthData = take(u16At('the QE authentication data size'), 'the QE authentication data');
  if (u16At('the PCK data type') !== 5) throw new DerError('the PCK data is not a PEM certificate chain');
  const pem = take(u32At('the PCK data size'), 'the PCK chain');
  if (at > outerEnd || at > signatureDataEnd) throw new DerError('the certification data overruns its size');
  return {
    signed,
    report,
    signature,
    attestationKey,
    qeReport,
    qeReportSignature,
    qeAuthData,
    pckChain: new TextDecoder().decode(pem),
  };
}

type SignedQuote =
  | { ok: true; quote: DcapQuote; path: Certificate[]; pck: ReturnType<typeof pckExtension> }
  | { ok: false; refusal: QuoteSignatureRefusal };

async function signedQuote(input: Uint8Array | string, nowSec: number): Promise<SignedQuote> {
  const refuse = (code: QuoteSignatureRefusal['code'], detail: string): SignedQuote => ({ ok: false, refusal: { code, detail } });

  // 1. The quote.
  let quote: DcapQuote;
  try {
    quote = parseDcapQuote(quoteBytes(input));
  } catch (error) {
    return refuse('malformed_quote', message(error));
  }

  // 2. The attestation key signed the header and the TD report.
  if (!(await verifyRawKey(quote.attestationKey, quote.signature, quote.signed))) {
    return refuse('bad_quote_signature', 'the attestation key did not sign the TD report');
  }

  // 3. The QE report data binds the attestation key.
  const bound = new Uint8Array(quote.attestationKey.length + quote.qeAuthData.length);
  bound.set(quote.attestationKey);
  bound.set(quote.qeAuthData, quote.attestationKey.length);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bound));
  const reportData = quote.qeReport.subarray(320, 384);
  if (!sameBytes(reportData.subarray(0, 32), hash) || !reportData.subarray(32).every((byte) => byte === 0)) {
    return refuse('qe_report_data_mismatch', 'the QE report does not commit to the attestation key');
  }

  // 4. The PCK certificate signed the QE report.
  let chain: ChainCertificate[];
  try {
    chain = pemCertificates(quote.pckChain).map(chainCertificate);
    if (chain.length === 0) throw new DerError('no certificate');
  } catch (error) {
    return refuse('malformed_certificate', message(error));
  }
  if (!(await verifySpki(chain[0]!.spki, quote.qeReportSignature, quote.qeReport))) {
    return refuse('bad_qe_report_signature', 'the PCK certificate did not sign the QE report');
  }

  // 5 to 7. The chain to the Intel root, and the validity of each certificate.
  const checked = await checkChain(chain, nowSec);
  if (!checked.ok) return checked;
  // The platform values of the PCK certificate, now that Intel's chain covers them.
  try {
    return { ok: true, quote, path: checked.path, pck: pckExtension(checked.path[0]!) };
  } catch (error) {
    return refuse('malformed_certificate', message(error));
  }
}

// ---------------------------------------------------------------------------------------------
// Certificate chains and CRLs.

interface ChainCertificate extends Certificate {
  /** The signature as `r || s`. */
  rawSignature: Bytes;
}

function chainCertificate(der: Bytes): ChainCertificate {
  const certificate = parseCertificate(der);
  if (certificate.signatureAlgorithm !== OID.ecdsaWithSha256) throw new DerError('not ECDSA with SHA-256');
  return { ...certificate, rawSignature: rawSignature(certificate.signature) };
}

type ChainCheck = { ok: true; path: Certificate[] } | { ok: false; refusal: QuoteSignatureRefusal };

/**
 * Checks a chain `[end entity, CA..., root?]`: each certificate is signed by the next one, the last
 * one before the root by the pinned Intel root. A root at the end (a certificate that issued
 * itself) must be the pinned root. `path` is the chain without its root.
 */
async function checkChain(chain: ChainCertificate[], nowSec: number): Promise<ChainCheck> {
  const refuse = (code: QuoteSignatureRefusal['code'], detail: string): ChainCheck => ({ ok: false, refusal: { code, detail } });
  const last = chain[chain.length - 1];
  const hasRoot = last !== undefined && sameBytes(last.issuer, last.subject);
  const path = hasRoot ? chain.slice(0, -1) : chain;
  if (path.length === 0) return refuse('bad_certificate_chain', 'the chain has no end-entity certificate');

  // The names and the CA flags.
  for (const [index, certificate] of path.entries()) {
    const issuer = path[index + 1] ?? ROOT;
    if (!sameBytes(certificate.issuer, issuer.subject)) return refuse('bad_certificate_chain', `certificate ${index}: the issuer name`);
    if (certificate.isCa !== index > 0) return refuse('bad_certificate_chain', `certificate ${index}: the CA flag`);
  }
  // 5. The signatures.
  for (const [index, certificate] of path.entries()) {
    const issuer = path[index + 1] ?? ROOT;
    if (!(await verifySpki(issuer.spki, certificate.rawSignature, certificate.tbs))) {
      return refuse('bad_certificate_signature', `certificate ${index} (${commonName(certificate)})`);
    }
  }
  // 6. The root.
  if (hasRoot && !sameBytes(last.raw, ROOT_DER)) return refuse('untrusted_root', 'the root of the chain is not the Intel SGX Root CA');
  // 7. The validity.
  for (const certificate of [...path, ROOT]) {
    if (nowSec * 1000 < certificate.notBeforeMs) return refuse('certificate_not_yet_valid', commonName(certificate));
    if (nowSec * 1000 > certificate.notAfterMs) return refuse('certificate_expired', commonName(certificate));
  }
  return { ok: true, path };
}

/**
 * Checks each certificate of `path` (and `root`, if `path` is empty) against the CRL of its
 * issuer, as webpki does for `dcap-qvl`: the issuer signed the CRL, the CRL's next update is
 * after now, and the CRL does not list the certificate. A certificate with no CRL is refused.
 */
async function revocation(path: Certificate[], root: Certificate, crls: Crl[], nowSec: number): Promise<QuoteCollateralCheck | null> {
  const refuse = (code: 'bad_crl_signature' | 'crl_expired' | 'revocation_unknown' | 'certificate_revoked', detail: string) => ({
    ok: false as const,
    refusal: { code, detail },
  });
  const targets: [Certificate, Certificate][] = path.length === 0 ? [[root, root]] : path.map((certificate, index) => [certificate, path[index + 1] ?? root]);
  for (const [certificate, issuer] of targets) {
    const crl = crls.find((candidate) => sameBytes(candidate.issuer, certificate.issuer));
    if (crl === undefined) return refuse('revocation_unknown', commonName(certificate));
    let signature: Bytes;
    try {
      signature = rawSignature(crl.signature);
    } catch {
      return refuse('bad_crl_signature', `the CRL of ${commonName(issuer)}: the signature cannot be read`);
    }
    if (!(await verifySpki(issuer.spki, signature, crl.tbs))) return refuse('bad_crl_signature', `the CRL of ${commonName(issuer)}`);
    if (nowSec * 1000 >= crl.nextUpdateMs) return refuse('crl_expired', `the CRL of ${commonName(issuer)}`);
    if (crl.revoked.has(certificate.serial)) return refuse('certificate_revoked', commonName(certificate));
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// The collateral.

interface Level {
  sgx: number[];
  tdx: number[];
  pcesvn: number;
  status: TcbStatus;
  advisoryIds: string[];
}

interface TcbInfo {
  id: string;
  version: number;
  fmspc: string;
  pceId: string;
  tcbLevels: Level[];
  tdxModule: ModuleIdentity | null;
  tdxModuleIdentities: (ModuleIdentity & { id: string; tcbLevels: { isvsvn: number; status: TcbStatus; advisoryIds: string[] }[] })[];
}

interface ModuleIdentity {
  mrsigner: Bytes;
  attributes: Bytes;
  attributesMask: Bytes;
}

interface QeIdentity {
  id: string;
  version: number;
  miscselect: Bytes;
  miscselectMask: Bytes;
  attributes: Bytes;
  attributesMask: Bytes;
  mrsigner: Bytes;
  isvprodid: number;
  tcbLevels: { isvsvn: number; status: TcbStatus; advisoryIds: string[] }[];
}

interface SignedDocument<T> {
  name: string;
  value: T;
  signed: Bytes;
  signature: Bytes;
  chain: ChainCertificate[];
  issueSec: number;
  nextUpdateSec: number;
}

interface ParsedCollateral {
  rootCrl: Crl;
  pckCrl: Crl;
  tcbInfo: SignedDocument<TcbInfo>;
  qeIdentity: SignedDocument<QeIdentity>;
}

function parseCollateral(collateral: QuoteCollateral): ParsedCollateral {
  if (typeof collateral !== 'object' || collateral === null) throw new DerError('no collateral');
  const crl = (hex: unknown, what: string) => {
    const parsed = parseCrl(hexBytes(hex, what));
    if (parsed.signatureAlgorithm !== OID.ecdsaWithSha256) throw new DerError(`${what}: not ECDSA with SHA-256`);
    return parsed;
  };
  const document = <T>(name: string, text: unknown, signature: unknown, chain: unknown, read: (json: Record<string, unknown>) => T): SignedDocument<T> => {
    if (typeof text !== 'string' || typeof chain !== 'string') throw new DerError(`${name}: not text`);
    const json = JSON.parse(text) as Record<string, unknown>;
    const signatureBytes = hexBytes(signature, `${name} signature`);
    if (signatureBytes.length !== 64) throw new DerError(`${name} signature length`);
    return {
      name,
      value: read(json),
      signed: new TextEncoder().encode(text),
      signature: signatureBytes,
      chain: pemCertificates(chain).map(chainCertificate),
      issueSec: dateSec(json.issueDate, `${name} issueDate`),
      nextUpdateSec: dateSec(json.nextUpdate, `${name} nextUpdate`),
    };
  };
  return {
    rootCrl: crl(collateral.root_ca_crl, 'root_ca_crl'),
    pckCrl: crl(collateral.pck_crl, 'pck_crl'),
    tcbInfo: document('TCB info', collateral.tcb_info, collateral.tcb_info_signature, collateral.tcb_info_issuer_chain, readTcbInfo),
    qeIdentity: document('QE identity', collateral.qe_identity, collateral.qe_identity_signature, collateral.qe_identity_issuer_chain, readQeIdentity),
  };
}

function readTcbInfo(json: Record<string, unknown>): TcbInfo {
  const isTdx = json.id === 'TDX' && Number(json.version) >= 3;
  const levels = list(json.tcbLevels, 'tcbLevels').map((item) => {
    const level = object(item, 'a TCB level');
    const tcb = object(level.tcb, 'a TCB');
    const svns = (value: unknown) => (value === undefined ? [] : list(value, 'TCB components').map((component) => int(object(component, 'a component').svn, 'svn')));
    return {
      sgx: svns(tcb.sgxtcbcomponents),
      tdx: svns(tcb.tdxtcbcomponents),
      pcesvn: int(tcb.pcesvn, 'pcesvn'),
      status: status(level.tcbStatus),
      advisoryIds: advisories(level.advisoryIDs),
    };
  });
  // Intel's QVL sorts the levels: SGX components, then PCE SVN, then TDX components, highest first.
  levels.sort((left, right) => compareSvns(right.sgx, left.sgx) || right.pcesvn - left.pcesvn || (isTdx ? compareSvns(right.tdx, left.tdx) : 0));
  const identity = (value: unknown, what: string): ModuleIdentity => {
    const item = object(value, what);
    return {
      mrsigner: hexBytes(item.mrsigner, `${what} mrsigner`, 48),
      attributes: hexBytes(item.attributes, `${what} attributes`, 8),
      attributesMask: hexBytes(item.attributesMask, `${what} attributesMask`, 8),
    };
  };
  return {
    id: String(json.id),
    version: int(json.version, 'version'),
    fmspc: hexText(json.fmspc, 'fmspc'),
    pceId: hexText(json.pceId, 'pceId'),
    tcbLevels: levels,
    tdxModule: json.tdxModule === undefined ? null : identity(json.tdxModule, 'tdxModule'),
    tdxModuleIdentities: (json.tdxModuleIdentities === undefined ? [] : list(json.tdxModuleIdentities, 'tdxModuleIdentities')).map((value) => {
      const item = object(value, 'a TDX module identity');
      return {
        ...identity(item, 'a TDX module identity'),
        id: String(item.id),
        tcbLevels: list(item.tcbLevels, 'module tcbLevels').map(isvLevel),
      };
    }),
  };
}

function readQeIdentity(json: Record<string, unknown>): QeIdentity {
  return {
    id: String(json.id),
    version: int(json.version, 'version'),
    miscselect: hexBytes(json.miscselect, 'miscselect', 4),
    miscselectMask: hexBytes(json.miscselectMask, 'miscselectMask', 4),
    attributes: hexBytes(json.attributes, 'attributes', 16),
    attributesMask: hexBytes(json.attributesMask, 'attributesMask', 16),
    mrsigner: hexBytes(json.mrsigner, 'mrsigner', 32),
    isvprodid: int(json.isvprodid, 'isvprodid'),
    tcbLevels: list(json.tcbLevels, 'tcbLevels').map(isvLevel),
  };
}

function isvLevel(value: unknown): { isvsvn: number; status: TcbStatus; advisoryIds: string[] } {
  const level = object(value, 'a TCB level');
  return {
    isvsvn: int(object(level.tcb, 'a TCB').isvsvn, 'isvsvn'),
    status: status(level.tcbStatus),
    advisoryIds: advisories(level.advisoryIDs),
  };
}

interface Status {
  status: TcbStatus;
  advisoryIds: string[];
}

/** The worse status, with the advisories of both. */
function merge(left: Status, right: Status): Status {
  const worse = SEVERITY.indexOf(right.status) > SEVERITY.indexOf(left.status) ? right.status : left.status;
  const advisoryIds = [...left.advisoryIds];
  for (const id of right.advisoryIds) if (!advisoryIds.includes(id)) advisoryIds.push(id);
  return { status: worse, advisoryIds };
}

/**
 * The TDX module of the TD report against the TCB info, as `dcap-qvl` does: MRSIGNER_SEAM and
 * SEAMATTRIBUTES against `tdxModule` or, for a module version above 0, the `tdxModuleIdentities`
 * entry `TDX_<version>`, whose TCB levels give a status. A string is a mismatch.
 */
function tdxModuleStatus(tcbInfo: TcbInfo, report: Bytes): Status | null | string {
  if (tcbInfo.tdxModule === null) return 'the TCB info has no tdxModule';
  const isvsvn = report[0]!;
  const version = report[1]!;
  let expected: ModuleIdentity = tcbInfo.tdxModule;
  let levels: TcbInfo['tdxModuleIdentities'][number]['tcbLevels'] | null = null;
  if (version > 0 && tcbInfo.tdxModuleIdentities.length > 0) {
    const wanted = `TDX_${version.toString(16).toUpperCase().padStart(2, '0')}`;
    const identity = tcbInfo.tdxModuleIdentities.find((item) => item.id.toUpperCase() === wanted);
    if (identity === undefined) return `no TDX module identity ${wanted}`;
    expected = identity;
    levels = identity.tcbLevels;
  }
  if (!sameBytes(report.subarray(64, 112), expected.mrsigner)) return 'MRSIGNER_SEAM';
  const attributes = report.subarray(112, 120);
  for (let index = 0; index < 8; index += 1) {
    const mask = expected.attributesMask[index]!;
    if ((attributes[index]! & mask) !== (expected.attributes[index]! & mask) || (attributes[index]! & ~mask & 0xff) !== 0) {
      return 'SEAMATTRIBUTES';
    }
  }
  if (levels === null) return null;
  const level = levels.find((item) => isvsvn >= item.isvsvn);
  if (level === undefined) return `the TDX module ISVSVN ${isvsvn} is below every TCB level`;
  return { status: level.status, advisoryIds: level.advisoryIds };
}

/** The TD attribute rules of `dcap-qvl`, with no debug TD and no service TD. Null if they pass. */
function tdAttributesProblem(quote: DcapQuote): string | null {
  const attributes = quote.report.subarray(120, 128);
  if ((attributes[0]! & 0x01) !== 0) return 'the TD runs in debug mode';
  if ((attributes[0]! & 0xfe) !== 0) return 'reserved TUD bits are set';
  const reservedSec = (attributes[1]! | attributes[2]! | (attributes[3]! & 0x0f)) !== 0 || (attributes[3]! & 0x20) !== 0;
  const reservedOther = (attributes[4]! & 0x7f) !== 0 || attributes[5] !== 0 || attributes[6] !== 0 || (attributes[7]! & 0x7f) !== 0;
  if (reservedSec || reservedOther) return 'reserved attribute bits are set';
  if ((attributes[3]! & 0x10) === 0) return 'SEPT_VE_DISABLE is not set';
  if (quote.report.length === 648 && !quote.report.subarray(600, 648).every((byte) => byte === 0)) return 'the TD is a service TD';
  return null;
}

// ---------------------------------------------------------------------------------------------
// Small readers.

function quoteBytes(input: Uint8Array | string): Bytes {
  if (typeof input === 'string') {
    try {
      return Uint8Array.from(atob(input), (char) => char.charCodeAt(0));
    } catch {
      throw new DerError('the quote is not base64');
    }
  }
  if (!(input instanceof Uint8Array)) throw new DerError('the quote is not bytes');
  return new Uint8Array(input);
}

function seconds(nowMs: number | undefined): number {
  return Math.floor((nowMs ?? Date.now()) / 1000);
}

function u16(bytes: Bytes, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function sameMasked(actual: Bytes, expected: Bytes, mask: Bytes): boolean {
  return actual.every((byte, index) => (byte & mask[index]!) === (expected[index]! & mask[index]!));
}

/** Compares two SVN lists as Rust compares two vectors: element by element, then by length. */
function compareSvns(left: number[], right: number[]): number {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) return left[index]! - right[index]!;
  }
  return left.length - right.length;
}

function hexBytes(value: unknown, what: string, length?: number): Bytes {
  if (typeof value !== 'string' || value.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(value)) throw new DerError(`${what}: not hex`);
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  if (length !== undefined && bytes.length !== length) throw new DerError(`${what}: length`);
  return bytes;
}

function hexText(value: unknown, what: string): string {
  return toHex(hexBytes(value, what));
}

function dateSec(value: unknown, what: string): number {
  const ms = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(ms)) throw new DerError(`${what}: not a date`);
  return Math.floor(ms / 1000);
}

function object(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new DerError(`${what}: not an object`);
  return value as Record<string, unknown>;
}

function list(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new DerError(`${what}: not a list`);
  return value;
}

function int(value: unknown, what: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new DerError(`${what}: not a number`);
  return value as number;
}

function status(value: unknown): TcbStatus {
  if (!SEVERITY.includes(value as TcbStatus)) throw new DerError(`unknown TCB status ${String(value)}`);
  return value as TcbStatus;
}

function advisories(value: unknown): string[] {
  if (value === undefined) return [];
  return list(value, 'advisoryIDs').map(String);
}

function commonName(certificate: Certificate): string {
  const text = new TextDecoder().decode(certificate.subject);
  return /Intel SGX [A-Za-z ]+/.exec(text)?.[0] ?? 'a certificate';
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
