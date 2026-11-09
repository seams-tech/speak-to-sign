// The rules for the spoken summary of a note.
//
// A port of `summaryRefusal` in the Seams Wallet SDK
// (packages/wallet/src/core/transactionFeatures/spokenNote.ts), which ports
// `spoken_intent::InvalidSummary`. The Wallet refuses a summary that breaks a rule with
// `summary_not_speakable`. The page shows this file's rule list and also gates with the SDK's
// own `summaryRefusal`. The Pages Function (functions/api/summary.ts) uses this file, because
// it cannot load the SDK.

export const SUMMARY_MAX_WORDS = 12;
export const SUMMARY_MAX_BYTES = 120;

/** Why a text is not a speakable summary, as in the SDK. */
export type SummaryRefusal = 'empty' | 'too_long' | 'too_many_words' | 'character' | 'transfer_verb';

const TRANSFER_VERBS = ['send', 'sent', 'sends'];

/**
 * Null for a speakable summary: 1 to 12 words of ASCII letters with one space between two
 * words, a comma allowed at the end of a word and one `.`, `!` or `?` at the end.
 */
export function summaryRefusal(text: string): SummaryRefusal | null {
  if (text === '') return 'empty';
  if (new TextEncoder().encode(text).length > SUMMARY_MAX_BYTES) return 'too_long';
  const body = /[.!?]$/.test(text) ? text.slice(0, -1) : text;
  const words = body.split(' ');
  for (const [index, word] of words.entries()) {
    const letters = word.endsWith(',') ? word.slice(0, -1) : word;
    if (!/^[A-Za-z]+$/.test(letters)) return 'character';
    if (index === 0 && TRANSFER_VERBS.includes(letters.toLowerCase())) return 'transfer_verb';
  }
  return words.length > SUMMARY_MAX_WORDS ? 'too_many_words' : null;
}

/** Trims the text and puts one space between two words. The page sends this form. */
export function normalizeSummary(text: string): string {
  return text.trim().split(/\s+/u).filter(Boolean).join(' ');
}

export type SummaryRuleId = 'length' | 'letters' | 'start';

export interface SummaryRule {
  id: SummaryRuleId;
  label: string;
  ok: boolean;
}

export interface SummaryCheck {
  ok: boolean;
  /** The normalized summary that the page sends to the Wallet. */
  spoken: string;
  words: number;
  refusal: SummaryRefusal | null;
  rules: SummaryRule[];
}

/** Checks the normalized summary and gives one line for each rule, for the live rule list. */
export function checkSummary(summary: string): SummaryCheck {
  const spoken = normalizeSummary(summary);
  const refusal = summaryRefusal(spoken);
  const body = /[.!?]$/.test(spoken) ? spoken.slice(0, -1) : spoken;
  const words = spoken === '' ? 0 : body.split(' ').length;
  const lettersOk =
    spoken !== '' && body.split(' ').every((word) => /^[A-Za-z]+$/.test(word.endsWith(',') ? word.slice(0, -1) : word));
  const rules: SummaryRule[] = [
    {
      id: 'length',
      label: `1 to ${SUMMARY_MAX_WORDS} words`,
      ok: words >= 1 && words <= SUMMARY_MAX_WORDS && refusal !== 'too_long',
    },
    {
      id: 'letters',
      label: 'Letters A to Z only: no digits, apostrophes, hyphens or links',
      ok: lettersOk,
    },
    {
      id: 'start',
      label: 'Does not start with “send”',
      ok: refusal !== 'transfer_verb',
    },
  ];
  return { ok: refusal === null, spoken, words, refusal, rules };
}
