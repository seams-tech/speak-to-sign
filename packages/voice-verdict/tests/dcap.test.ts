// The Intel DCAP check, with the real quote of a verifier call on OutLayer testnet and the Intel
// collateral of its platform at that time (see the comments of the two fixtures).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  checkAttestationBinding,
  checkQuoteCollateral,
  checkQuoteSignature,
  fetchCollateral,
  INTEL_SGX_ROOT_CA_SHA256,
  type AttestationRecord,
  type QuoteCollateral,
} from '../src/index.ts';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const { record } = fixture('outlayer_attestation_testnet.json') as { record: AttestationRecord };
const { collateral } = fixture('intel_collateral_testnet.json') as { collateral: QuoteCollateral };
const QUOTE = Uint8Array.from(Buffer.from(record.tdx_quote, 'base64'));
/** The time of the call: the collateral is valid at this time. */
const AT_MS = record.timestamp * 1000;

// Offsets in this quote (version 4): header 48, TD report 584, then the signature data.
const SIGNATURE = 48 + 584 + 4;
const QE_REPORT = SIGNATURE + 64 + 64 + 6;
const QE_AUTH = QE_REPORT + 384 + 64;
const PEM = QE_AUTH + 2 + 32 + 6;
const PEM_SIZE = new DataView(QUOTE.buffer).getUint32(PEM - 4, true);

function flipped(offset: number): Uint8Array {
  const copy = QUOTE.slice();
  copy[offset]! ^= 0x01;
  return copy;
}

/** The DER certificates of the PEM chain of the quote. */
function chain(): Buffer[] {
  const text = Buffer.from(QUOTE.subarray(PEM, PEM + PEM_SIZE)).toString('latin1');
  return [...text.matchAll(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g)].map((match) =>
    Buffer.from(match[1]!.replace(/\s+/g, ''), 'base64'),
  );
}

/** The quote with another PEM chain, and with the three sizes that hold it. */
function withChain(certificates: Buffer[]): Uint8Array {
  const pem = certificates
    .map((der) => `-----BEGIN CERTIFICATE-----\n${der.toString('base64').replace(/(.{64})/g, '$1\n').replace(/\n$/, '')}\n-----END CERTIFICATE-----\n`)
    .join('');
  const body = Buffer.from(pem, 'latin1');
  const grown = body.length - PEM_SIZE;
  const out = Buffer.concat([Buffer.from(QUOTE.subarray(0, PEM)), body, Buffer.from(QUOTE.subarray(PEM + PEM_SIZE))]);
  out.writeUInt32LE(PEM_SIZE + grown, PEM - 4);
  out.writeUInt32LE(out.readUInt32LE(SIGNATURE + 128 + 2) + grown, SIGNATURE + 128 + 2);
  out.writeUInt32LE(out.readUInt32LE(SIGNATURE - 4) + grown, SIGNATURE - 4);
  return Uint8Array.from(out);
}

const code = async (quote: Uint8Array | string, nowMs = AT_MS) => {
  const result = await checkQuoteSignature({ quote, nowMs });
  return result.ok ? 'ok' : result.refusal.code;
};

test('an Intel TDX platform signed the quote, through the PCK chain to the Intel root', async () => {
  const result = await checkQuoteSignature({ quote: record.tdx_quote, nowMs: AT_MS });
  assert.deepEqual(result, { ok: true, fmspc: 'b0c06f000000', notChecked: ['tcb_status', 'qe_identity', 'revocation', 'td_attributes'] });
  // The bytes give the same result as the base64, and the default time is now.
  assert.ok((await checkQuoteSignature({ quote: QUOTE })).ok);
  // The chain rebuilt from its own certificates passes: the test helper changes nothing.
  assert.equal(await code(withChain(chain())), 'ok');
});

test('the pinned root is the root of the quote, and its SHA-256 is the published one', () => {
  const root = chain()[2]!;
  assert.equal(createHash('sha256').update(root).digest('hex'), INTEL_SGX_ROOT_CA_SHA256);
});

test('each changed part of the quote gives its own refusal', async () => {
  assert.equal(await code('AAAA'), 'malformed_quote');
  assert.equal(await code(QUOTE.subarray(0, 1000)), 'malformed_quote');
  assert.equal(await code(flipped(0)), 'malformed_quote'); // the version
  // The TD report (the body) and the quote signature.
  assert.equal(await code(flipped(48 + 520)), 'bad_quote_signature');
  assert.equal(await code(flipped(SIGNATURE + 10)), 'bad_quote_signature');
  // The attestation key: the quote signature fails first.
  assert.equal(await code(flipped(SIGNATURE + 64 + 5)), 'bad_quote_signature');
  // The QE authentication data and the QE report data.
  assert.equal(await code(flipped(QE_AUTH + 2)), 'qe_report_data_mismatch');
  assert.equal(await code(flipped(QE_REPORT + 320)), 'qe_report_data_mismatch');
  assert.equal(await code(flipped(QE_REPORT + 360)), 'qe_report_data_mismatch');
  // Another field of the QE report, and the QE report signature.
  assert.equal(await code(flipped(QE_REPORT + 0)), 'bad_qe_report_signature');
  assert.equal(await code(flipped(QE_REPORT + 384 + 3)), 'bad_qe_report_signature');
});

test('each changed certificate gives its own refusal', async () => {
  const [leaf, intermediate, root] = chain() as [Buffer, Buffer, Buffer];
  const change = (der: Buffer, offset: number) => {
    const copy = Buffer.from(der);
    copy[offset]! ^= 0x01;
    return copy;
  };
  // The serial number of the PCK certificate (in the signed part).
  assert.equal(await code(withChain([change(leaf, 16), intermediate, root])), 'bad_certificate_signature');
  // The signature of the PCK CA certificate.
  assert.equal(await code(withChain([leaf, change(intermediate, intermediate.length - 5), root])), 'bad_certificate_signature');
  // A root that is not the Intel root, and a chain with no root (the pinned root completes it).
  assert.equal(await code(withChain([leaf, intermediate, change(root, root.length - 5)])), 'untrusted_root');
  assert.equal(await code(withChain([leaf, intermediate])), 'ok');
  // A chain in the wrong order, a chain with no CA, and bytes that are not a certificate.
  assert.equal(await code(withChain([intermediate, leaf, root])), 'bad_qe_report_signature');
  assert.equal(await code(withChain([leaf, root])), 'bad_certificate_chain');
  assert.equal(await code(withChain([leaf.subarray(0, 100), intermediate, root])), 'malformed_certificate');
});

test('the certificates must be valid at nowMs', async () => {
  // The PCK certificate is valid from 2026-06-17T08:42:11Z to 2033-06-17T08:42:11Z, and the PCK
  // CA certificate to 2033-05-21T10:50:10Z.
  assert.equal(await code(QUOTE, Date.UTC(2026, 5, 17, 8, 42, 11)), 'ok');
  assert.equal(await code(QUOTE, Date.UTC(2026, 5, 17, 8, 42, 10)), 'certificate_not_yet_valid');
  assert.equal(await code(QUOTE, Date.UTC(2033, 4, 21, 10, 50, 10)), 'ok');
  assert.equal(await code(QUOTE, Date.UTC(2033, 4, 21, 10, 50, 11)), 'certificate_expired');
  assert.equal(await code(QUOTE, Date.UTC(2033, 5, 17, 8, 42, 12)), 'certificate_expired');
});

const full = async (change: Partial<QuoteCollateral> = {}, nowMs = AT_MS, quote: Uint8Array = QUOTE) => {
  const result = await checkQuoteCollateral({ quote, nowMs, collateral: { ...collateral, ...change } });
  return result.ok ? 'ok' : result.refusal.code;
};

test('with the Intel collateral, the platform is UpToDate, as dcap-qvl 0.5.2 says', async () => {
  const result = await checkQuoteCollateral({ quote: record.tdx_quote, nowMs: AT_MS, collateral });
  assert.deepEqual(result, { ok: true, fmspc: 'b0c06f000000', tcbStatus: 'UpToDate', advisoryIds: [], notChecked: [] });
});

test('the collateral of Intel PCS gives the same result as dcap-qvl 0.7.1', async () => {
  const pcs = (fixture('intel_pcs_collateral_testnet.json') as { collateral: QuoteCollateral }).collateral;
  const at = async (nowMs: number) => {
    const result = await checkQuoteCollateral({ quote: QUOTE, nowMs, collateral: pcs });
    return result.ok ? `${result.tcbStatus} ${result.advisoryIds.length}` : result.refusal.code;
  };
  assert.equal(await at(Date.UTC(2026, 10, 10, 18, 36)), 'UpToDate 0');
  // This TCB info was issued after the call: dcap-qvl says "TCBInfo issue date is in the future".
  assert.equal(await at(AT_MS), 'collateral_not_yet_valid');
});

test('the collateral is valid only in its time window, as in dcap-qvl', async () => {
  // dcap-qvl 0.5.2 at 1797000000: "TCBInfo expired"; at 1794000000: "issue date is in the future".
  assert.equal(await full({}, 1_797_000_000_000), 'collateral_expired');
  assert.equal(await full({}, 1_794_000_000_000), 'collateral_not_yet_valid');
});

test('each changed part of the collateral gives its own refusal', async () => {
  const tcbInfo = JSON.parse(collateral.tcb_info) as Record<string, unknown>;
  const qeIdentity = JSON.parse(collateral.qe_identity) as Record<string, unknown>;
  const flipHex = (hex: string, index: number) => hex.slice(0, index) + (hex[index] === '0' ? '1' : '0') + hex.slice(index + 1);
  // The signed documents.
  assert.equal(await full({ tcb_info: collateral.tcb_info.replace('"UpToDate"', '"OutOfDate"') }), 'bad_collateral_signature');
  assert.equal(await full({ tcb_info_signature: flipHex(collateral.tcb_info_signature, 10) }), 'bad_collateral_signature');
  assert.equal(await full({ qe_identity: collateral.qe_identity.replace('"isvprodid":2', '"isvprodid":3') }), 'bad_collateral_signature');
  assert.equal(await full({ qe_identity_signature: flipHex(collateral.qe_identity_signature, 70) }), 'bad_collateral_signature');
  // The signing chain of a document: the PCK chain of the quote is not an Intel signing chain.
  const pckChain = Buffer.from(QUOTE.subarray(PEM, PEM + PEM_SIZE)).toString('latin1');
  assert.equal(await full({ tcb_info_issuer_chain: pckChain }), 'bad_collateral_signature');
  // The CRLs: a changed signature, a CRL of another issuer, and bytes that are not a CRL.
  assert.equal(await full({ pck_crl: flipHex(collateral.pck_crl, collateral.pck_crl.length - 10) }), 'bad_crl_signature');
  assert.equal(await full({ pck_crl: collateral.root_ca_crl }), 'revocation_unknown');
  assert.equal(await full({ root_ca_crl: 'abcd' }), 'malformed_collateral');
  assert.equal(await full({ tcb_info: 'not json' }), 'malformed_collateral');
  // The CRLs of the collateral expire on 2026-12-07T23:47:52Z, before the TCB info.
  assert.ok(String(tcbInfo.nextUpdate) > '2026-12-07T23:47:52Z');
  // dcap-qvl 0.5.2 gives the same: CrlExpired at that second, UpToDate one second before.
  assert.equal(await full({}, Date.UTC(2026, 11, 7, 23, 47, 52)), 'crl_expired');
  assert.equal(await full({}, Date.UTC(2026, 11, 7, 23, 47, 51)), 'ok');
  assert.ok(qeIdentity.mrsigner);
});

test('the full check accepts a PCK chain that ends at the PCK CA, and refuses a bad chain', async () => {
  const [leaf, intermediate, root] = chain() as [Buffer, Buffer, Buffer];
  assert.equal(await full({}, AT_MS, withChain([leaf, intermediate])), 'ok');
  assert.equal(await full({}, AT_MS, withChain([leaf, root])), 'bad_certificate_chain');
});

test('the collateral of OutLayer at the time of a call', async () => {
  const reply = fixture('intel_collateral_testnet.json') as { reply: Record<string, unknown>; collateral: QuoteCollateral };
  let asked = '';
  const served = (async (url: unknown) => {
    asked = String(url);
    return Response.json({ ...reply.reply, collateral: JSON.stringify(reply.collateral) });
  }) as typeof fetch;
  const fetched = await fetchCollateral({ baseUrl: 'https://testnet-api.outlayer.ai/', fmspc: 'B0C06F000000', atMs: AT_MS, fetch: served });
  assert.equal(asked, `https://testnet-api.outlayer.ai/public/collateral?fmspc=b0c06f000000&at=${record.timestamp}`);
  assert.equal(fetched.coversRequestedTime, true);
  assert.equal(fetched.contractId, 'worker.outlayer.testnet');
  assert.deepEqual(fetched.collateral, collateral);
  await assert.rejects(fetchCollateral({ baseUrl: 'http://testnet-api.outlayer.ai', fmspc: 'b0c06f000000', atMs: AT_MS, fetch: served }), RangeError);
  await assert.rejects(fetchCollateral({ baseUrl: 'https://testnet-api.outlayer.ai', fmspc: 'b0c06f', atMs: AT_MS, fetch: served }), RangeError);
});

test('the quote of a bound record goes to the DCAP check unchanged', async () => {
  const bound = await checkAttestationBinding({
    record,
    output: fixture('outlayer_attestation_testnet.json').output,
    acceptedWasmHashes: ['96b79b518613a50538b060da2279c91e12b0619499c532c2708f61ddb790d7e5'],
  });
  assert.ok(bound.ok);
  const result = await checkQuoteCollateral({ quote: bound.quote, nowMs: AT_MS, collateral });
  assert.ok(result.ok && result.tcbStatus === 'UpToDate');
});
