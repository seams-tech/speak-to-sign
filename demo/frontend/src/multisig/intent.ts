// The spoken multisig intent on the page. The rules are the ones of the `spoken-intent`
// grammar (crates/spoken-intent): an amount is a whole number of hundredths of a NEAR, from
// 0.01 to 1,000,000 NEAR (NearAmount), and the receiver is a named account (SpokenAccount).
// The sentence is the grammar's display text: "Approve proposal 7: send 25 NEAR to grants.testnet".

const YOCTO_PER_HUNDREDTH = 10n ** 22n;
const MAX_HUNDREDTHS = 100_000_000;

export type AmountCheck = { ok: true; hundredths: number; yocto: string } | { ok: false; error: string };

/** "25", "2.5", "0.05" or "1,250" NEAR. */
export function parseNearAmount(text: string): AmountCheck {
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(text.trim().replace(/,/g, ''));
  if (!match) return { ok: false, error: 'Write the amount in NEAR with at most two decimals, for example 25 or 2.5.' };
  const hundredths = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  if (hundredths < 1 || hundredths > MAX_HUNDREDTHS) {
    return { ok: false, error: 'The amount must be from 0.01 NEAR to 1,000,000 NEAR.' };
  }
  return { ok: true, hundredths, yocto: (BigInt(hundredths) * YOCTO_PER_HUNDREDTH).toString() };
}

/** The hundredths of a decimal yoctoNEAR amount, or null if the grammar cannot say it. */
export function hundredthsOfYocto(yocto: string): number | null {
  if (!/^(0|[1-9]\d*)$/.test(yocto)) return null;
  const value = BigInt(yocto);
  if (value % YOCTO_PER_HUNDREDTH !== 0n) return null;
  const hundredths = value / YOCTO_PER_HUNDREDTH;
  return hundredths >= 1n && hundredths <= BigInt(MAX_HUNDREDTHS) ? Number(hundredths) : null;
}

/** The grammar's display of an amount: "1,250", "2.5" or "0.05". */
export function formatNear(hundredths: number): string {
  const whole = Math.floor(hundredths / 100).toLocaleString('en-US');
  const fraction = hundredths % 100;
  if (fraction === 0) return whole;
  return `${whole}.${String(fraction).padStart(2, '0').replace(/0$/, '')}`;
}

/** A yoctoNEAR amount for display, "25" or the raw value if the grammar cannot say it. */
export function formatYocto(yocto: string): string {
  const hundredths = hundredthsOfYocto(yocto);
  return hundredths === null ? `${yocto} yocto` : formatNear(hundredths);
}

/** A named NEAR account that the grammar can speak: no implicit (64 hex) or 0x account. */
export function isSpeakableAccount(accountId: string): boolean {
  if (/^[0-9a-fA-F]{64}$/.test(accountId) || accountId.startsWith('0x')) return false;
  if (accountId.length < 2 || accountId.length > 64) return false;
  return accountId.split('.').every((part) => /^[a-z0-9]+([-_][a-z0-9]+)*$/.test(part));
}

/** The sentence that the proposer reads aloud. */
export function proposalSentence(proposalId: number, amount: string, receiver: string): string {
  return `Approve proposal ${proposalId}: send ${amount} NEAR to ${receiver}`;
}

/** The sentence of a proposal to hide a note, the grammar's display text. */
export function hideSentence(proposalId: number, noteId: number): string {
  return `Approve proposal ${proposalId}: hide note ${noteId}`;
}

/** Lowercase hex of unpadded base64url bytes (the verifier's commitment and salt), or null. */
export function hexOfBase64Url(text: string, length: number): string | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  let binary: string;
  try {
    binary = atob(text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '='));
  } catch {
    return null;
  }
  if (binary.length !== length) return null;
  return [...binary].map((char) => char.charCodeAt(0).toString(16).padStart(2, '0')).join('');
}
