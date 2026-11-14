// The words for a voice setup that cannot pass, and the check that comes before it.
//
// The verifier takes an enrollment only with a signature of a full-access key of the account,
// and it reads that key on NEAR testnet. A new Seams wallet is an implicit account: it is on
// testnet only after its first NEAR, from the faucet or from any other sender. Before that, the
// verifier finds no key and refuses with `not_authorized` and the detail
// `authorization: unknown_key`.

import type { Funds } from '../faucet/funds';

/** For an account that is not on testnet: before the recordings, and after an `unknown_key`. */
export const NOT_ON_TESTNET =
  'This account is not on NEAR testnet yet, because it has no NEAR. The verifier reads the key of the account there. Get testnet NEAR for the account, then set up your voice.';

/** The detail of the verifier for a signer key that it did not find on testnet. */
const UNKNOWN_KEY = 'authorization: unknown_key';

/**
 * False only for an account that is not on testnet and that the faucet did not fund. After a
 * drip, the NEAR lands while the visitor records. Funds that were not read count as present: the
 * verifier decides.
 */
export function verifierCanFind(funds: Pick<Funds, 'balance' | 'faucet'>): boolean {
  return funds.faucet.kind === 'sent' || !(funds.balance && funds.balance.free === null);
}

const ENROLL_REFUSALS: Record<string, string> = {
  quality: 'A recording was too short or too quiet.',
  speaker: 'The three recordings do not sound like one speaker.',
  audio_reused: 'A recording was used before.',
  audio_invalid: 'The verifier could not read a recording.',
  unsupported: 'The verifier does not support this request.',
  speaker_unavailable: 'The speaker check service did not answer.',
  storage: 'The verifier could not store the template.',
  template_exists: 'Another enrollment changed the template at the same time.',
  not_authorized: 'The signed message is not from a full-access key of this account.',
  authorization_unavailable: 'The verifier could not read the access keys of this account.',
};

/** A refusal of the verifier, with its detail after it. */
export function withDetail(text: string, detail: string | undefined): string {
  return detail ? `${text} ${detail}` : text;
}

/** An enrollment that the verifier refused, in plain words. */
export function enrollRefusalText(reason: string, detail: string | undefined): string {
  if (reason === 'not_authorized' && detail === UNKNOWN_KEY) return NOT_ON_TESTNET;
  return withDetail(ENROLL_REFUSALS[reason] ?? `The verifier refused (${reason}).`, detail);
}
