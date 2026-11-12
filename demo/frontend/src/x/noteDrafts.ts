// The draft of a note for a post from X. The demo fills it in, so a visitor only presses the
// button and speaks the summary that the Seams server writes from it. The posts route writes a
// draft for each post once (functions/lib/noteDrafts.ts). This file has the check and the drafts
// for a post that has none.

export interface NoteDraftText {
  /** The note, 1 to 280 characters. */
  text: string;
}

export const MAX_DRAFT_NOTE_CHARS = 280;

/** The draft, trimmed, if the note has a legal length. A stored draft can still have a summary: it is left out. */
export function validDraft(value: unknown): NoteDraftText | null {
  if (typeof value !== 'object' || value === null) return null;
  const { text } = value as { text?: unknown };
  if (typeof text !== 'string') return null;
  const note = text.trim().replace(/\s+/g, ' ');
  const length = [...note].length;
  return length === 0 || length > MAX_DRAFT_NOTE_CHARS ? null : { text: note };
}

// A careful note for each subject. It says what the post leaves out, and states no fact about
// the world, so it is safe for any post of that subject.
const BY_TOPIC: Record<string, NoteDraftText> = {
  sport: {
    text: 'The post gives numbers and no source or time period for them. Check the official statistics before you share it.',
  },
  science: {
    text: 'The post makes a claim about research and names no study. Look for the original source before you trust it.',
  },
  technology: {
    text: 'The post states a technical claim and shows no way to check it. Treat it as unverified until someone repeats the test.',
  },
  business: {
    text: 'The post makes a claim about a company and links no report, filing or statement that supports it.',
  },
  entertainment: {
    text: 'The post reports news about a person or a studio and links no statement from them. It can be a rumour.',
  },
  politics: {
    text: 'The post makes a claim about a government, a law or a politician and links no official record or statement for it.',
  },
  health: {
    text: 'The post makes a medical claim and names no study or health authority. Ask a doctor or check an official source.',
  },
};

const GENERAL: NoteDraftText = {
  text: 'The post presents a claim as a fact and gives no source for it. Look for a reliable source before you share it.',
};

/** The draft for a post that the model wrote none for. */
export function fallbackDraft(topic: string | null | undefined): NoteDraftText {
  return (topic && BY_TOPIC[topic]) || GENERAL;
}
