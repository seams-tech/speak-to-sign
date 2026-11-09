import type { PhraseResultView } from '@seams/wallet/speak-to-sign-host';

/** A refused verdict is not signature-checked, so its text is cut short and shown as plain text. */
const MAX_HEARD_CHARS = 160;

/**
 * The words that the verifier heard, with each word that the alignment with the spoken sentence
 * does not match marked. The Wallet passes them as `heard: <words>` in the refusal detail.
 */
export function heardCaption(
  spokenText: string,
  detail: string | undefined,
): PhraseResultView['caption'] {
  const heard = detail?.startsWith('heard: ')
    ? detail.slice('heard: '.length).slice(0, MAX_HEARD_CHARS).trim()
    : '';
  if (!heard) return 'The verifier heard different words.';
  const words = heard.split(/\s+/);
  const matched = alignedWords(words.map(normalWord), spokenText.split(' ').map(normalWord));
  const parts: (string | { mark: string })[] = ['We heard “'];
  for (const [index, word] of words.entries()) {
    if (index > 0) parts.push(' ');
    parts.push(matched.has(index) ? word : { mark: word });
  }
  parts.push('”');
  return parts;
}

/** The indices of heard words in a longest common subsequence with the expected words. */
function alignedWords(heard: readonly string[], expected: readonly string[]): Set<number> {
  const lengths = Array.from({ length: heard.length + 1 }, () =>
    new Array<number>(expected.length + 1).fill(0),
  );
  for (let i = heard.length - 1; i >= 0; i -= 1) {
    for (let j = expected.length - 1; j >= 0; j -= 1) {
      lengths[i][j] =
        heard[i] === expected[j]
          ? lengths[i + 1][j + 1] + 1
          : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const matched = new Set<number>();
  let i = 0;
  let j = 0;
  while (i < heard.length && j < expected.length) {
    if (heard[i] === expected[j]) {
      matched.add(i);
      i += 1;
      j += 1;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) i += 1;
    else j += 1;
  }
  return matched;
}

function normalWord(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}
