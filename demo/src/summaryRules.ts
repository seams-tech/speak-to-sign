// The rules for the spoken summary of a note.
//
// The page and the Pages Function (functions/api/summary.ts) both use this
// file. Swap it for the Seams SDK check when the SDK exports one.

export const SUMMARY_MAX_WORDS = 12;

export type SummaryRuleId = 'length' | 'letters' | 'numbers' | 'links';

export interface SummaryRule {
  id: SummaryRuleId;
  label: string;
  ok: boolean;
}

export interface SummaryCheck {
  ok: boolean;
  /** The summary without end punctuation and extra spaces. */
  spoken: string;
  words: number;
  rules: SummaryRule[];
}

const END_PUNCTUATION = /[\s.!?…]+$/u;
const ALLOWED = /^[\p{L}\p{M}'’ ]*$/u;
const DIGIT = /\p{Nd}/u;
const URL_LIKE = /(https?:\/\/|www\.|[\p{L}\p{Nd}]\.[\p{L}]{2,})/iu;
const LINK_MARKS = /[@＠#＃\-‐‑‒–—―−]/u;

/** Removes end punctuation and joins the words with one space. */
export function spokenForm(summary: string): string {
  return summary.trim().replace(END_PUNCTUATION, '').split(/\s+/u).filter(Boolean).join(' ');
}

export function checkSummary(summary: string): SummaryCheck {
  const spoken = spokenForm(summary);
  const words = spoken === '' ? 0 : spoken.split(' ').length;
  const rules: SummaryRule[] = [
    {
      id: 'length',
      label: `1 to ${SUMMARY_MAX_WORDS} words`,
      ok: words >= 1 && words <= SUMMARY_MAX_WORDS,
    },
    {
      id: 'letters',
      label: 'Only letters, spaces and apostrophes',
      ok: /\p{L}/u.test(spoken) && ALLOWED.test(spoken),
    },
    {
      id: 'numbers',
      label: 'No digits: write numbers as words',
      ok: !DIGIT.test(spoken),
    },
    {
      id: 'links',
      label: 'No links, handles, # or hyphens',
      ok: !URL_LIKE.test(spoken) && !LINK_MARKS.test(spoken),
    },
  ];
  return { ok: rules.every((rule) => rule.ok), spoken, words, rules };
}
