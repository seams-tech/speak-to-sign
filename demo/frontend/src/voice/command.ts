// Voice commands of the notes app: what the visitor can ask for, what the page tells the
// classifier about the screen, and how the classifier's scores become one command.
//
// A command only moves the page: it changes the tab, moves to the next post, opens the write
// dialog, the rating dialog or the bet sheet, or starts a new market. It signs nothing. A note or a bet is still signed by the spoken request in the Seams
// Wallet, where the verifier checks the voice and the words. So a wrong command cannot sign.
//
// The page, the Pages Function (functions/api/voice-command.ts) and the tests share this file.

export type TimelineTab = 'fresh' | 'controversial' | 'open' | 'decided';
export const TIMELINE_TABS: readonly TimelineTab[] = ['fresh', 'controversial', 'open', 'decided'];

export type BetSide = 'yes' | 'no';

/** The ratings of a note, as the notes contract names them. */
export type NoteRating = 'helpful' | 'somewhat_helpful' | 'not_helpful';
export const NOTE_RATINGS: readonly NoteRating[] = ['helpful', 'somewhat_helpful', 'not_helpful'];

export type MoveTo = 'next' | 'previous';
export const MOVES: readonly MoveTo[] = ['next', 'previous'];

export type VoiceCommand =
  | { kind: 'show'; tab: TimelineTab }
  /** To the post after or before the focused post. It becomes "this one". */
  | { kind: 'move'; to: MoveTo }
  /** To one post that the sentence names: "scroll to the first post". It becomes "this one". */
  | { kind: 'go'; postId: number }
  | { kind: 'write_note'; postId: number }
  /** `amount` in USDC base units. Null: the bet sheet's own amount. */
  | { kind: 'bet'; postId: number; side: BetSide; amount: bigint | null }
  /** A rating of the note of a post. */
  | { kind: 'rate'; postId: number; rating: NoteRating }
  /** A new prediction market on the note of a post. */
  | { kind: 'open_market'; postId: number }
  /** The sentence asks for a note, a rating, a bet or a market, and the screen has no post or note that it can mean. */
  | { kind: 'no_target'; action: 'go' | 'write_note' | 'rate' | 'bet' | 'open_market' }
  | { kind: 'none' };

/** One post of the timeline, as the classifier reads it. */
export interface ScreenPost {
  postId: number;
  author: string;
  text: string;
  /** The note that the card shows, if any. */
  note?: string;
}

/**
 * The posts of the timeline's tab, from the top. A post is "post 1", "post 2", ... by its place
 * here, and its note is "note 1", "note 2", ... by its place among the posts with a note.
 */
export interface Screen {
  posts: ScreenPost[];
  /** The post that "this one" means: the card at the centre of the view (the next one on a tie). */
  focusedPostId: number | null;
}

/** The classifier reads this many posts at most. */
export const MAX_SCREEN_POSTS = 8;
const MAX_POST_CHARS = 200;
const MAX_TRANSCRIPT_CHARS = 300;

/** The request body of POST /api/voice-command. */
export interface CommandRequest {
  transcript: string;
  posts: { author: string; text: string; note?: string }[];
}

/** Probabilities from 0 to 1. `post[i]` and `note[i]` follow the order of the request's posts. */
export interface CommandScores {
  show: Record<TimelineTab, number>;
  move: Record<MoveTo, number>;
  /** Go to one post that the sentence names. */
  goTo: number;
  writeNote: number;
  /** Rate a note with this rating. */
  rate: Record<NoteRating, number>;
  bet: number;
  /** Open a new prediction market on a note. */
  openMarket: number;
  /** The bet is on "no". */
  betNo: number;
  /** The speaker means post i. */
  post: number[];
  /** The speaker means the note of post i. 0 for a post with no note. */
  note: number[];
}

export function commandRequest(transcript: string, screen: Screen): CommandRequest {
  return {
    transcript: transcript.trim().slice(0, MAX_TRANSCRIPT_CHARS),
    posts: screen.posts.slice(0, MAX_SCREEN_POSTS).map(({ author, text, note }) => ({
      author,
      text: clip(text),
      ...(note === undefined ? {} : { note: clip(note) }),
    })),
  };
}

function clip(text: string): string {
  const letters = [...text.replace(/\s+/g, ' ').trim()];
  return letters.length > MAX_POST_CHARS ? `${letters.slice(0, MAX_POST_CHARS).join('')}…` : letters.join('');
}

/** A score at or above this counts as "yes". */
const SURE = 0.6;

/**
 * The one command of the scores. An action that needs a post takes the post that the speaker
 * named, or else the focused post ("this one").
 */
export function decideCommand(scores: CommandScores, screen: Screen, transcript: string): VoiceCommand {
  const posts = screen.posts.slice(0, MAX_SCREEN_POSTS);
  // A rating, a bet or a market is on a note. "The second note" names it; "this one" is the focused post's note.
  const notedPost = () => {
    const named = posts[best(scores.note)] ?? posts[best(scores.post)];
    const post = named ?? posts.find((candidate) => candidate.postId === screen.focusedPostId);
    return post && post.note !== undefined ? post : null;
  };
  const namedPost = () => posts[best(scores.post)] ?? posts[best(scores.note)];
  const goTo = (): VoiceCommand => {
    const post = namedPost();
    return post ? { kind: 'go', postId: post.postId } : { kind: 'no_target', action: 'go' };
  };
  const actions: { score: number; command: () => VoiceCommand }[] = [
    ...TIMELINE_TABS.map((tab) => ({ score: scores.show[tab], command: (): VoiceCommand => ({ kind: 'show', tab }) })),
    // "Scroll down to the first post" names its post: the direction does not count then.
    ...MOVES.map((to) => ({ score: scores.move[to], command: (): VoiceCommand => (namedPost() ? goTo() : { kind: 'move', to }) })),
    { score: scores.goTo, command: goTo },
    ...NOTE_RATINGS.map((rating) => ({
      score: scores.rate[rating],
      command: (): VoiceCommand => {
        const post = notedPost();
        return post ? { kind: 'rate', postId: post.postId, rating } : { kind: 'no_target', action: 'rate' };
      },
    })),
    {
      score: scores.writeNote,
      command: () => {
        const postId = posts[best(scores.post)]?.postId ?? screen.focusedPostId;
        return postId === null ? { kind: 'no_target', action: 'write_note' } : { kind: 'write_note', postId };
      },
    },
    {
      score: scores.bet,
      command: () => {
        const post = notedPost();
        if (!post) return { kind: 'no_target', action: 'bet' };
        const side = spokenSide(transcript) ?? (scores.betNo >= 0.5 ? 'no' : 'yes');
        return { kind: 'bet', postId: post.postId, side, amount: spokenUsdc(transcript) };
      },
    },
    {
      score: scores.openMarket,
      command: () => {
        const post = notedPost();
        return post ? { kind: 'open_market', postId: post.postId } : { kind: 'no_target', action: 'open_market' };
      },
    },
  ];
  const top = actions.reduce((a, b) => (b.score > a.score ? b : a));
  return top.score >= SURE ? top.command() : { kind: 'none' };
}

/** The index of the highest score, when it is sure. -1 if none. */
function best(scores: number[]): number {
  let index = -1;
  for (let i = 0; i < scores.length; i += 1) {
    if ((scores[i] ?? 0) >= SURE && (index === -1 || (scores[i] ?? 0) > (scores[index] ?? 0))) index = i;
  }
  return index;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  a: 1, an: 1,
};
const NUMBER = String.raw`\d+(?:\.\d+)?|${Object.keys(NUMBER_WORDS).join('|')}`;
const DOLLARS = new RegExp(String.raw`(?:\$\s*(\d+(?:\.\d+)?))|(?:\b(${NUMBER}|half(?: a)?)[\s-]*(?:dollars?|bucks?|usdc?|\$))`, 'i');
const CENTS = new RegExp(String.raw`\b(${NUMBER})[\s-]*cents?\b`, 'i');
// "Bet 1 on no": a speech-to-text model can drop the word "dollar". "A" is no amount here.
const BARE = new RegExp(String.raw`\b(?:bet|put|stake|wager)\s+(\d+(?:\.\d+)?|${Object.keys(NUMBER_WORDS).filter((word) => word.length > 2).join('|')})\b(?!\s*(?:%|percent|st\b|nd\b|rd\b|th\b))`, 'i');
const USDC_UNITS = 1_000_000;

/**
 * The amount of money in a sentence, in USDC base units: "$1", "one dollar", "0.5 usdc", "half a
 * dollar", "fifty cents", and a number with no unit right after "bet" ("bet 1 on no"). Null when
 * the sentence names none. A speech-to-text model writes an amount as digits or as words, so
 * both count.
 */
export function spokenUsdc(text: string): bigint | null {
  const dollars = DOLLARS.exec(text);
  if (dollars) {
    const word = (dollars[1] ?? dollars[2] ?? '').toLowerCase();
    const value = word.startsWith('half') ? 0.5 : numberOf(word);
    return value === null ? null : units(value);
  }
  const cents = CENTS.exec(text);
  if (cents) {
    const value = numberOf((cents[1] ?? '').toLowerCase());
    return value === null ? null : units(value / 100);
  }
  const bare = BARE.exec(text);
  const value = bare ? numberOf((bare[1] ?? '').toLowerCase()) : null;
  return value === null ? null : units(value);
}

function numberOf(word: string): number | null {
  const value = NUMBER_WORDS[word] ?? Number(word);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Whole cents only: a spoken bet is a whole number of cents. */
function units(usdc: number): bigint | null {
  const cents = Math.round(usdc * 100);
  return cents > 0 && cents <= 100_000_000 ? BigInt(cents) * BigInt(USDC_UNITS / 100) : null;
}

const YES_WORDS = /\b(yes|yeah|yep)\b/i;
// A speech-to-text model can write "bet no on this post" as "but knowing this post".
const NO_WORDS = /\b(no|nope|knowing)\b/i;

/**
 * The side of a bet from its words, as the amount comes from its words. Null when the sentence
 * has words of both sides or of neither: the classifier's score then decides.
 */
export function spokenSide(text: string): BetSide | null {
  const yes = YES_WORDS.test(text);
  return yes === NO_WORDS.test(text) ? null : yes ? 'yes' : 'no';
}

/** Reads the answer of POST /api/voice-command. Null when it is not a set of scores. */
export function readScores(body: unknown, posts: number): CommandScores | null {
  if (typeof body !== 'object' || body === null) return null;
  const { show, move, goTo, writeNote, rate, bet, openMarket, betNo, post, note } = body as Record<string, unknown>;
  const list = (value: unknown): number[] | null =>
    Array.isArray(value) && value.length === posts && value.every(isScore) ? (value as number[]) : null;
  const postScores = list(post);
  const noteScores = list(note);
  const record = <Key extends string>(value: unknown, keys: readonly Key[]): Record<Key, number> | null =>
    typeof value === 'object' && value !== null && keys.every((key) => isScore((value as Record<string, unknown>)[key])) ? (value as Record<Key, number>) : null;
  const tabs = record(show, TIMELINE_TABS);
  const moves = record(move, MOVES);
  const ratings = record(rate, NOTE_RATINGS);
  if (!tabs || !moves || !ratings || !postScores || !noteScores) return null;
  if (!isScore(goTo) || !isScore(writeNote) || !isScore(bet) || !isScore(openMarket) || !isScore(betNo)) return null;
  return { show: tabs, move: moves, goTo, writeNote, rate: ratings, bet, openMarket, betNo, post: postScores, note: noteScores };
}

function isScore(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value <= 1;
}

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];

/**
 * Scores from plain word rules, for when the classifier does not answer (no key, no network).
 * It knows the demo's sentences only: it is a fallback, not a second classifier.
 */
export function ruleScores(request: CommandRequest): CommandScores {
  const text = request.transcript.toLowerCase();
  const has = (pattern: RegExp) => (pattern.test(text) ? 1 : 0);
  const bet = has(/\bbet\b/);
  const openMarket = bet ? 0 : has(/\b(open|start|create|make)\b.*\bmarket\b/);
  const ordinal = ORDINALS.findIndex((word) => new RegExp(String.raw`\b${word}\b`).test(text));
  const aboutNote = /\b(first|second|third|fourth|fifth|sixth|seventh|eighth)\s+(community\s+)?note\b/.test(text);
  const noted = request.posts.flatMap((post, index) => (post.note === undefined ? [] : [index]));
  const post = request.posts.map((_, index) => (!aboutNote && index === ordinal ? 1 : 0));
  const note = request.posts.map((_, index) => (aboutNote && noted[ordinal] === index ? 1 : 0));
  const showing = /\b(show|see|go to|open|list)\b/.test(text) && !bet && !openMarket;
  return {
    show: {
      controversial: showing ? has(/\b(controversial|disputed|contested)\b/) : 0,
      fresh: showing ? has(/\b(fresh|new|latest|all)\b.*\bposts?\b/) : 0,
      open: showing ? has(/\bopen markets?\b/) : 0,
      decided: showing ? has(/\b(decided|resolved|closed)\b/) : 0,
    },
    move: { next: has(/\b(next|scroll down)\b/), previous: has(/\b(previous|go back|scroll up)\b/) },
    goTo: bet || openMarket ? 0 : has(/\b(scroll|go|jump|move|take me)\b.*\bto\b.*\b(post|note|one)\b/),
    writeNote: bet || openMarket ? 0 : has(/\b(add|write|post|create)\b.*\bnote\b/),
    rate: {
      helpful: bet ? 0 : has(/(?<!not |somewhat |un)\bhelpful\b/),
      somewhat_helpful: bet ? 0 : has(/\bsomewhat helpful\b/),
      not_helpful: bet ? 0 : has(/\b(not helpful|unhelpful)\b/),
    },
    bet,
    openMarket,
    betNo: has(/\b(on|bet)\s+no\b|\bno\b\s*$/),
    post,
    note,
  };
}
