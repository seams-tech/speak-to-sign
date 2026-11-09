import { isPlainObject } from '@seams/wallet/speak-to-sign-host';
import type { VaultTransferRequest } from './intent';
import { base64Standard } from './verdict';

/** The verifier accepts at most this many contacts. */
const MAX_CONTACTS = 32;

export type VaultState = Readonly<{
  nonce: bigint;
  /** Every contact, active or not, in vault order. The verifier uses them for the confusion set. */
  contacts: readonly string[];
  verifierPublicKey: string;
}>;

/** Reads `get_vault`, `get_contacts` and `get_verifier` results, or null if one is malformed. */
export function parseVaultState(views: {
  readonly vault: unknown;
  readonly contacts: unknown;
  readonly verifier: unknown;
}): VaultState | null {
  const { vault, contacts, verifier } = views;
  if (!isPlainObject(vault) || !isPlainObject(verifier) || !Array.isArray(contacts)) return null;
  const nonce = decimal(vault.next_nonce);
  const key = verifier.verifier_public_key;
  if (nonce === null || typeof key !== 'string' || !key.startsWith('ed25519:')) return null;
  const names: string[] = [];
  for (const contact of contacts) {
    if (!isPlainObject(contact) || typeof contact.account_id !== 'string') return null;
    names.push(contact.account_id);
  }
  return { nonce, contacts: names.slice(0, MAX_CONTACTS), verifierPublicKey: key };
}

/** The verify input, as the demo client sends it to the verifier. */
export function verifyInput(
  request: VaultTransferRequest,
  contacts: readonly string[],
  wav: Uint8Array,
): Readonly<Record<string, unknown>> {
  return {
    op: 'verify',
    vault: request.vault,
    owner: request.owner,
    receiver: request.receiver,
    amount_yocto: request.amountYocto.toString(),
    nonce: Number(request.nonce),
    contacts: [...contacts],
    audio_wav_b64: base64Standard(wav),
  };
}

/** The `transfer_with_verdict` arguments. The verdict text goes through unchanged. */
export function transferArgs(
  request: VaultTransferRequest,
  verdictJson: string,
  signatureB64: string,
) {
  return {
    receiver_id: request.receiver,
    amount: request.amountYocto.toString(),
    nonce: request.nonce.toString(),
    verdict_json: verdictJson,
    signature_b64: signatureB64,
  } as const;
}

function decimal(value: unknown): bigint | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === 'string' && /^(0|[1-9]\d{0,19})$/.test(value)) {
    const parsed = BigInt(value);
    return parsed < 2n ** 64n ? parsed : null;
  }
  return null;
}
