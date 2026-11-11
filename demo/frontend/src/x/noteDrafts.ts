// The draft of a note for a post from X: the note text and the short sentence that the visitor
// reads aloud to post it. The demo fills both in, so a visitor only presses the button and
// speaks. The posts route writes a draft for each post once (functions/lib/noteDrafts.ts). This
// file has the checks and the drafts for a post that has none.

import { checkSummary } from '../summaryRules.ts';

export interface NoteDraftText {
  /** The note, 1 to 280 characters. */
  text: string;
  /** The spoken sentence: 1 to 12 words of the letters A to Z (src/summaryRules.ts). */
  summary: string;
}

export const MAX_DRAFT_NOTE_CHARS = 280;

/** The draft, trimmed, if the note has a legal length and the sentence can be spoken. */
export function validDraft(value: unknown): NoteDraftText | null {
  if (typeof value !== 'object' || value === null) return null;
  const { text, summary } = value as { text?: unknown; summary?: unknown };
  if (typeof text !== 'string' || typeof summary !== 'string') return null;
  const note = text.trim().replace(/\s+/g, ' ');
  const length = [...note].length;
  if (length === 0 || length > MAX_DRAFT_NOTE_CHARS) return null;
  const check = checkSummary(summary.toLowerCase());
  return check.ok ? { text: note, summary: check.spoken } : null;
}

// A careful note for each subject. It says what the post leaves out, and states no fact about
// the world, so it is safe for any post of that subject.
const BY_TOPIC: Record<string, NoteDraftText> = {
  sport: {
    text: 'The post gives numbers and no source or time period for them. Check the official statistics before you share it.',
    summary: 'this post gives numbers with no source',
  },
  science: {
    text: 'The post makes a claim about research and names no study. Look for the original source before you trust it.',
    summary: 'this post names no study for its claim',
  },
  technology: {
    text: 'The post states a technical claim and shows no way to check it. Treat it as unverified until someone repeats the test.',
    summary: 'this technical claim has no proof yet',
  },
  business: {
    text: 'The post makes a claim about a company and links no report, filing or statement that supports it.',
    summary: 'this business claim has no source',
  },
  entertainment: {
    text: 'The post reports news about a person or a studio and links no statement from them. It can be a rumour.',
    summary: 'this post can be a rumour with no statement',
  },
  politics: {
    text: 'The post makes a claim about a government, a law or a politician and links no official record or statement for it.',
    summary: 'this political claim has no official source',
  },
  health: {
    text: 'The post makes a medical claim and names no study or health authority. Ask a doctor or check an official source.',
    summary: 'this medical claim names no study',
  },
};

const GENERAL: NoteDraftText = {
  text: 'The post presents a claim as a fact and gives no source for it. Look for a reliable source before you share it.',
  summary: 'this post gives no source for its claim',
};

/** The draft for a post that the model wrote none for. */
export function fallbackDraft(topic: string | null | undefined): NoteDraftText {
  return (topic && BY_TOPIC[topic]) || GENERAL;
}
