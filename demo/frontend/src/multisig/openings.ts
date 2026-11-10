// The opening of a proposal: the transfer or the note to hide, and the salt behind its on-chain
// commitment. Only the proposer's browser gets it (the verifier returns the salt to
// `multisig_propose` and `multisig_hide_note`), and the approve route needs it for `execute`. It
// stays in localStorage, keyed by contract and proposal id, until the proposal is executed.

export type Opening = TransferOpening | HideOpening;

export interface TransferOpening {
  receiver: string;
  amount_yocto: string;
  salt_hex: string;
  commitment_hex: string;
}

export interface HideOpening {
  note_id: number;
  salt_hex: string;
  commitment_hex: string;
}

export function isHide(opening: Opening): opening is HideOpening {
  return 'note_id' in opening;
}

const HEX_32 = /^[0-9a-f]{64}$/;

function key(contract: string, proposalId: number): string {
  return `voice-multisig:opening:${contract}:${proposalId}`;
}

export function readOpening(contract: string, proposalId: number): Opening | null {
  try {
    const value = JSON.parse(localStorage.getItem(key(contract, proposalId)) ?? 'null') as Record<string, unknown> | null;
    if (!value || typeof value.salt_hex !== 'string' || !HEX_32.test(value.salt_hex)) return null;
    if (typeof value.commitment_hex !== 'string' || !HEX_32.test(value.commitment_hex)) return null;
    const { salt_hex, commitment_hex } = value;
    if (typeof value.note_id === 'number' && Number.isSafeInteger(value.note_id) && value.note_id >= 1) {
      return { note_id: value.note_id, salt_hex, commitment_hex };
    }
    if (typeof value.receiver === 'string' && typeof value.amount_yocto === 'string') {
      return { receiver: value.receiver, amount_yocto: value.amount_yocto, salt_hex, commitment_hex };
    }
  } catch {
    // No storage, or a value that is not JSON.
  }
  return null;
}

/** False when the browser does not store it (a private window, or storage turned off). */
export function writeOpening(contract: string, proposalId: number, opening: Opening): boolean {
  try {
    localStorage.setItem(key(contract, proposalId), JSON.stringify(opening));
    return true;
  } catch {
    return false;
  }
}

/** The proposal is executed: its opening is not needed again. */
export function removeOpening(contract: string, proposalId: number): void {
  try {
    localStorage.removeItem(key(contract, proposalId));
  } catch {
    // No storage.
  }
}
