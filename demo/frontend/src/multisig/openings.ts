// The opening of a proposal: the transfer and the salt behind its on-chain commitment. Only the
// proposer's browser gets it (the verifier returns the salt to `multisig_propose`), and
// `execute` needs it. It stays in localStorage, keyed by contract and proposal id, until the
// proposal is executed. The other signers never see it: each one says the proposal from memory.

export interface Opening {
  receiver: string;
  amount_yocto: string;
  salt_hex: string;
  commitment_hex: string;
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
    if (typeof value.receiver !== 'string' || typeof value.amount_yocto !== 'string') return null;
    return { receiver: value.receiver, amount_yocto: value.amount_yocto, salt_hex: value.salt_hex, commitment_hex: value.commitment_hex };
  } catch {
    // No storage, or a value that is not JSON.
    return null;
  }
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
