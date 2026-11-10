/** The silence that ends a recording when the expected sentence is unknown or not yet said. */
const END_PAUSE_MS = 1_500;
/**
 * The silence that ends a recording once the voiced time covers the expected sentence. A pause
 * inside the sentence comes before that point, so it still gets `END_PAUSE_MS`.
 */
const SHORT_END_PAUSE_MS = 800;
/**
 * Voiced time of one spoken word at a fast pace. Normal speech is about 300 ms a word, and
 * pauses between words are not voiced, so most speakers pass this before the last word ends.
 */
const VOICED_MS_PER_WORD = 200;

/** The silence that ends a recording after `voicedMs` of speech. */
export function endPauseMs(voicedMs: number, expectedSpeechMs: number | null): number {
  return expectedSpeechMs !== null && voicedMs >= expectedSpeechMs
    ? SHORT_END_PAUSE_MS
    : END_PAUSE_MS;
}

/**
 * The least voiced time of the whole `sentence` as people read it aloud. Digits, dots and dashes
 * are words of their own: "Send 0.01 NEAR to seams-v1.testnet" is read as 13 words ("send zero
 * point zero one near to seams dash v one dot testnet").
 */
export function expectedSpeechMs(sentence: string): number {
  const words = sentence
    .trim()
    .replace(/[.!?,;:]+$/, '')
    .split(/\s+/)
    .filter(Boolean)
    .reduce((count, word) => count + spokenWords(word), 0);
  return words * VOICED_MS_PER_WORD;
}

function spokenWords(word: string): number {
  const letters = word.match(/[A-Za-z]+/g)?.length ?? 0;
  const digits = word.match(/[0-9]/g)?.length ?? 0;
  const marks = word.match(/[.\-_@]/g)?.length ?? 0;
  return Math.max(1, letters + digits + marks);
}
