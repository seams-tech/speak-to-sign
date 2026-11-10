// The opening of a proposal: the transfer and the salt behind its on-chain commitment. Only the
// proposer's browser gets it (the verifier returns the salt only to `multisig_propose`), and
// `execute` needs it. It stays in localStorage, keyed by contract and proposal id.

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
    const value = JSON.parse(localStorage.getItem(key(contract, proposalId)) ?? 'null') as Partial<Opening> | null;
    if (
      value &&
      typeof value.receiver === 'string' &&
      typeof value.amount_yocto === 'string' &&
      typeof value.salt_hex === 'string' &&
      HEX_32.test(value.salt_hex) &&
      typeof value.commitment_hex === 'string' &&
      HEX_32.test(value.commitment_hex)
    ) {
      return value as Opening;
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
