/**
 * The rules of a summary that a person says aloud (`confirmationRequest`, `summary`). They are
 * the rules of the verifier's `spoken-intent` crate (`InvalidSummary`): the verifier refuses a
 * request whose summary breaks one (`unsupported`). Check a summary with `summaryRefusal` before
 * you show it or send it.
 */

/** Twelve plain words fit in one 8 s clip. */
export const MAX_SUMMARY_WORDS = 12;
export const MAX_SUMMARY_BYTES = 120;

/** The first words of the transfer sentence ("Send 2 NEAR to …"). A summary cannot start with one. */
const TRANSFER_VERBS = ['send', 'sent', 'sends'];

/** Why a text is not a speakable summary. */
export type SummaryRefusal = 'empty' | 'too_long' | 'too_many_words' | 'character' | 'transfer_verb';

/**
 * Null for a speakable summary: 1 to 12 words of the letters A to Z with one space between two
 * words, a comma allowed at the end of a word, and one `.`, `!` or `?` allowed at the end.
 */
export function summaryRefusal(text: string): SummaryRefusal | null {
  if (text === '') return 'empty';
  if (new TextEncoder().encode(text).length > MAX_SUMMARY_BYTES) return 'too_long';
  const body = /[.!?]$/.test(text) ? text.slice(0, -1) : text;
  const words = body.split(' ');
  for (const [index, word] of words.entries()) {
    const letters = word.endsWith(',') ? word.slice(0, -1) : word;
    if (!/^[A-Za-z]+$/.test(letters)) return 'character';
    if (index === 0 && TRANSFER_VERBS.includes(letters.toLowerCase())) return 'transfer_verb';
  }
  return words.length > MAX_SUMMARY_WORDS ? 'too_many_words' : null;
}
