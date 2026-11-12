// The draft of a note for a post from X. The demo fills it in, so a visitor only presses the
// button and speaks the summary that the Seams server writes from it. The posts route asks a
// NEAR AI model for each draft (functions/lib/noteDrafts.ts), and marks who wrote it: the model,
// or the careful template of the post's subject when the model gave no note. A template is not
// final: the route asks the model again on a later refresh. This file has the check, the marks
// and the templates.

export interface NoteDraftText {
  /** The note, 1 to 280 characters. */
  text: string;
}

/** Who wrote a draft: the NEAR AI model, or the template of the post's subject. */
export type DraftSource = 'model' | 'template';

/** The draft of a post as the route gives it. */
export interface PostDraft extends NoteDraftText {
  /** Who wrote the note. No mark: a draft of an older route, or of the fixture, which a person wrote. */
  source?: DraftSource;
  /** A template only: the NEAR AI answers that had no valid note for this post. */
  modelTries?: number;
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

/**
 * True for a valid draft that the route marks as the model's. A draft with no mark (an older
 * snapshot, or the fixture's notes, which a person wrote) is not.
 */
export function isModelDraft(value: unknown): boolean {
  return validDraft(value) !== null && (value as { source?: unknown }).source === 'model';
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

const TEMPLATE_TEXTS = new Set([...Object.values(BY_TOPIC), GENERAL].map((draft) => draft.text));

/** The draft for a post that the model wrote none for. */
export function fallbackDraft(topic: string | null | undefined): NoteDraftText {
  return (topic && BY_TOPIC[topic]) || GENERAL;
}

/** True when the text is one of the templates. A draft of an older route has no mark, so the route reads its source from its text. */
export function isTemplateText(text: string): boolean {
  return TEMPLATE_TEXTS.has(text);
}
