// The timeline of the notes app: the demo post and the posts from X that can get a note, each
// with its note and the state of its market. The timeline is the app's one view: the visitor
// writes, rates and bets on the card itself, and the dialogs open over the timeline. A click on
// a card opens its bet (when its market takes bets) or the write dialog.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { IconChevronDown, IconUsers } from '@tabler/icons-react';
import { ActionRow, AuthorBadge, Avatar, Media, PostText } from '../components/bits';
import { NoteRateLine, shownNote } from '../components/NotesBox';
import { CONTEXT_MARKET_NOTE_ID, NoteDialog } from '../components/PostContext';
import { POSTS, type Post } from '../data/posts';
import { useDemo } from '../demoContext';
import { useMarketSource } from '../market/contractSource';
import { amountText, jevSentence, percentText, timeLeftText, yesShareBps } from '../market/math';
import { NoteMarketStrip, type BetRequest } from '../market/NoteMarket';
import { useBetVoice } from '../market/SayBet';
import { marketContext } from '../market/noteContext';
import type { NoteMarket, Side } from '../market/types';
import type { Note } from '../notes/types';
import { MAX_SCREEN_POSTS, type Screen, type TimelineTab, type VoiceCommand } from '../voice/command';
import { VoiceBar } from '../voice/VoiceBar';
import { controversy } from './controversy';
import { X_POSTS_LINE } from './xPosts';
import './timeline.css';

type Tab = TimelineTab;
const TABS: { id: Tab; label: string }[] = [
  { id: 'fresh', label: 'For you' },
  { id: 'controversial', label: 'Controversial' },
  { id: 'open', label: 'Open markets' },
  { id: 'decided', label: 'Settled' },
];

/**
 * The timeline's tabs. One blue underline is under the label of the tab that is on, and it
 * slides to the next one, and takes its width, when the visitor changes the tab. The tabs have
 * equal widths, so the underline's place is a share of the bar (styles.css), at every width.
 * Only the width of the bold label is measured.
 */
function TabBar({ tab, onTab }: { tab: Tab; onTab: (tab: Tab) => void }) {
  const nav = useRef<HTMLElement>(null);
  const [labelWidth, setLabelWidth] = useState<number | null>(null);
  const index = TABS.findIndex(({ id }) => id === tab);

  useLayoutEffect(() => {
    const label = nav.current?.querySelector<HTMLElement>('.tab-on span');
    if (label) setLabelWidth(label.getBoundingClientRect().width);
  }, [tab]);

  const style = { '--n': TABS.length, '--i': index, '--w': `${labelWidth ?? 0}px` } as CSSProperties;
  return (
    <nav className="tabs tabs-slide" aria-label="Timeline" ref={nav}>
      {TABS.map(({ id, label }) => (
        <button key={id} type="button" className={`tab ${tab === id ? 'tab-on' : ''}`} aria-current={tab === id} onClick={() => onTab(id)}>
          <span>{label}</span>
        </button>
      ))}
      {/* It mounts at its place, so it slides only from one tab to another. */}
      {labelWidth !== null && <span className="tabs-bar" aria-hidden="true" style={style} />}
    </nav>
  );
}

/** The note that a card shows, and the id that its market has in the market contract. */
interface CardNote {
  marketNoteId: number;
  text: string;
  /** More lines of the note, which show when the card's note is open. */
  details: string[];
  /** False for a note that still needs ratings. */
  shown: boolean;
  /** The note on the notes contract. The demo post's context is not one. */
  note?: Note;
}

/** The demo post shows the note that it got on X. Another post shows its best note of this app. */
export function cardNote(post: Post, notes: Note[]): CardNote | null {
  if (post.context) return { marketNoteId: CONTEXT_MARKET_NOTE_ID, text: post.context.text, details: post.context.examples, shown: true };
  const note = shownNote(notes) ?? [...notes].sort((a, b) => b.helpful - a.helpful || a.id - b.id)[0];
  return note ? { marketNoteId: note.id, text: note.text, details: [], shown: note.status === 'helpful', note } : null;
}

/** `open`: bets are on. `decided`: JEV answered. `closed`: between the two. */
export function marketTab(market: NoteMarket | null | undefined, nowMs: number): 'open' | 'closed' | 'decided' | null {
  if (!market) return null;
  if (market.status === 'resolved') return 'decided';
  return market.status === 'open' && market.closesAtMs > nowMs ? 'open' : 'closed';
}

interface Card {
  post: Post;
  note: CardNote | null;
}

/** What a voice command asked of the market of one post's note: a bet, or a new market. */
interface VoiceBet {
  postId: number;
  /** The bet, for the note dialog of the demo post. */
  bet?: { side: Side; amount: bigint | null };
  request: BetRequest;
}

/** Where the browser keeps the visitor's choice for the voice bar: on or off. */
const VOICE_ON_KEY = 'notes.voice-commands';

/** Each bet request of the page has its own number (see BetRequest). */
let betSeq = 0;
const nextBetSeq = () => (betSeq += 1);

/** Brings a post's card into view in the timeline, and flashes it. */
export function showCard(postId: number) {
  const card = document.getElementById(postCardId(postId));
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.classList.remove('note-fresh');
  // A new frame restarts the flash when the same card is chosen twice.
  requestAnimationFrame(() => card.classList.add('note-fresh'));
  window.setTimeout(() => card.classList.remove('note-fresh'), 2400);
}

/**
 * The element that scrolls the timeline, or null when the window scrolls it. On the Speak-to-Sign
 * page the timeline scrolls inside a panel, so the window does not move.
 */
function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node;
  }
  return null;
}

/** Brings a post's card to the centre of the view, where it is "this one" for a voice command. */
function focusCard(postId: number) {
  document.getElementById(postCardId(postId))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/** The height of the line across the middle of the part of the view where `element` scrolls. */
function viewCentre(element: HTMLElement): number {
  const scroller = scrollParent(element)?.getBoundingClientRect();
  const top = Math.max(0, scroller?.top ?? 0);
  const bottom = Math.min(window.innerHeight, scroller?.bottom ?? window.innerHeight);
  return (top + bottom) / 2;
}

/**
 * The post that "this one" means while the voice bar is on: the first of `ids` (post ids with
 * commas, in timeline order) whose card is on the line across the middle of the view. If the
 * line is between two cards, or on the edge between them, it is the next card: the one below.
 */
function useFocusedPost(ids: string, active: boolean): number | null {
  const [focused, setFocused] = useState<number | null>(null);
  const read = useCallback(() => {
    let line: number | null = null;
    let found: number | null = null;
    for (const id of ids === '' ? [] : ids.split(',').map(Number)) {
      const card = document.getElementById(postCardId(id));
      if (!card) continue;
      line ??= viewCentre(card);
      if (card.getBoundingClientRect().bottom > line) {
        found = id;
        break;
      }
    }
    setFocused(found);
  }, [ids]);
  useEffect(() => {
    if (!active) {
      setFocused(null);
      return;
    }
    read();
    let frame = 0;
    const onMove = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(read);
    };
    // The timeline can scroll inside the page's app window, so listen in the capture phase.
    document.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [active, read]);
  return focused;
}

export function Timeline() {
  const { notesByPost, xPosts, xPostsState, xPostsMore, openWrite, openRate, account } = useDemo();
  const source = useMarketSource();
  const [tab, setTab] = useState<Tab>('fresh');
  const [markets, setMarkets] = useState<Record<number, NoteMarket | null>>({});
  const now = Date.now();

  const cards = useMemo(
    () => [...POSTS, ...xPosts].map((post) => ({ post, note: cardNote(post, notesByPost[post.id] ?? []) })),
    [xPosts, notesByPost],
  );

  // One market read for each note on the timeline. A read that fails counts as "no market".
  const noteIds = cards.flatMap((card) => (card.note ? [card.note.marketNoteId] : []));
  const noteKey = noteIds.join(',');
  useEffect(() => {
    let cancelled = false;
    for (const noteId of noteKey === '' ? [] : noteKey.split(',').map(Number)) {
      source
        .getMarketForNote(noteId)
        .catch(() => null)
        .then((market) => {
          if (!cancelled) setMarkets((current) => ({ ...current, [noteId]: market }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [noteKey, source]);

  const marketOf = (card: Card) => (card.note ? markets[card.note.marketNoteId] : null);
  const visible =
    tab === 'controversial'
      ? cards
          .map((card) => ({ card, score: controversy(card.post, card.note?.note, marketOf(card)) }))
          .filter(({ score }) => score > 0)
          // The most disputed first. The sort is stable, so equal posts keep the timeline's order.
          .sort((a, b) => b.score - a.score)
          .map(({ card }) => card)
      : cards.filter((card) => tab === 'fresh' || marketTab(marketOf(card), now) === tab);

  // Voice commands (src/voice). With the bar on, the post at the centre of the view is "this
  // one". It and the posts near it show the numbers that the visitor can say, with their notes.
  // The bar stays on across a reload. The browser's storage can be off: the bar then starts off.
  const [voiceOn, setVoiceOnState] = useState(() => {
    try {
      return localStorage.getItem(VOICE_ON_KEY) === '1';
    } catch {
      return false;
    }
  });
  const setVoiceOn = (on: boolean) => {
    setVoiceOnState(on);
    try {
      localStorage.setItem(VOICE_ON_KEY, on ? '1' : '0');
    } catch {
      // The choice then lasts until the reload.
    }
  };
  const [voiceBet, setVoiceBet] = useState<VoiceBet | null>(null);
  /** The start of the timeline: a new tab shows its posts from here. */
  const timelineTop = useRef<HTMLDivElement>(null);
  const focusedPostId = useFocusedPost(visible.map((card) => card.post.id).join(','), voiceOn);
  // The posts that the classifier sees and that have numbers: 8 posts from `first`. The numbers
  // stay while "this one" is among them. When it leaves them, they start again one post above
  // it. So "this one" always has a number, and a number does not change under the visitor.
  const focusIndex = visible.findIndex((card) => card.post.id === focusedPostId);
  const [first, setFirst] = useState(0);
  const lastFirst = Math.max(0, visible.length - MAX_SCREEN_POSTS);
  const outside = focusIndex >= 0 && (focusIndex < first || focusIndex >= first + MAX_SCREEN_POSTS);
  const nextFirst = Math.min(outside ? Math.max(0, focusIndex - 1) : first, lastFirst);
  if (nextFirst !== first) setFirst(nextFirst);
  const spoken = visible.slice(nextFirst, nextFirst + MAX_SCREEN_POSTS);
  const postNumbers = new Map(spoken.map((card, index) => [card.post.id, index + 1]));
  const noteNumbers = new Map(spoken.filter((card) => card.note).map((card, index) => [card.post.id, index + 1]));
  const screen = (): Screen => ({
    posts: spoken.map(({ post, note }) => ({ postId: post.id, author: post.author.name, text: post.text, note: note?.text })),
    focusedPostId,
  });
  /** Runs a voice command. The result is the problem to show in the bar, or null when it ran. */
  const runCommand = (command: VoiceCommand): string | null => {
    if (command.kind === 'show') {
      setTab(command.tab);
      timelineTop.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return null;
    }
    if (command.kind === 'none') return 'No command in that sentence.';
    if (command.kind === 'move') {
      // From the focused post, to any post of the tab. With no post in view, "next" is the first post.
      const target = visible[command.to === 'next' ? focusIndex + 1 : focusIndex - 1];
      if (!target) return command.to === 'next' ? 'This is the last post.' : 'This is the first post.';
      focusCard(target.post.id);
      return null;
    }
    if (command.kind === 'go') {
      const target = spoken.find((candidate) => candidate.post.id === command.postId);
      if (!target) return 'That post is not on the screen.';
      focusCard(target.post.id);
      return null;
    }
    if (command.kind === 'no_target') {
      const needs = { rate: 'A rating', bet: 'A bet', open_market: 'A market' } as const;
      if (command.action === 'go') return 'Say which post: "scroll to the second post".';
      return command.action === 'write_note' ? 'That post is not on the screen.' : `${needs[command.action]} needs a note. That note is not on the screen.`;
    }
    const card = spoken.find((candidate) => candidate.post.id === command.postId);
    if (!card) return 'That post is not on the screen.';
    showCard(card.post.id);
    if (command.kind === 'write_note') {
      openWrite(card.post.id, { autoSign: true });
      return null;
    }
    const noteName = `Note ${noteNumbers.get(card.post.id) ?? ''}`.trim();
    if (command.kind === 'rate') {
      // Only a note of this app takes a rating, and not from its own author.
      const note = card.note?.note;
      if (!note) return `${noteName} is from X. It takes no rating here.`;
      if (note.author === account) return `You wrote ${noteName.toLowerCase()}. Other accounts rate it.`;
      openRate(note.id, { rating: command.rating, autoSign: true });
      return null;
    }
    const market = marketOf(card);
    // A note of this app with no market can get one: the strip's "Open a market".
    const canOpenMarket = market === null && card.note?.note !== undefined && source.createMarket !== undefined;
    if (command.kind === 'open_market' || (canOpenMarket && command.kind === 'bet')) {
      if (market) return `${noteName} has a market already.`;
      if (!canOpenMarket) return `${noteName} cannot get a market now.`;
      const bet = command.kind === 'bet' ? { side: command.side, amount: command.amount ?? undefined, place: true } : {};
      setVoiceBet({ postId: card.post.id, request: { seq: nextBetSeq(), open: true, ...bet } });
      return null;
    }
    if (marketTab(market, Date.now()) !== 'open') return `${noteName} has no open market, so it takes no bet.`;
    // With no amount in the sentence, the bet takes the amount that the sheet or the slider shows.
    setVoiceBet({ postId: card.post.id, bet: command, request: { seq: nextBetSeq(), side: command.side, amount: command.amount ?? undefined, place: true } });
    return null;
  };

  return (
    <>
      <div ref={timelineTop} aria-hidden="true" />
      <h1 className="sr-only">Posts that need context</h1>
      <TabBar tab={tab} onTab={setTab} />
      {visible.map(({ post, note }) => (
        <PostCard
          key={post.id}
          post={post}
          note={note}
          market={note ? markets[note.marketNoteId] : null}
          voice={
            voiceOn && postNumbers.has(post.id)
              ? { number: postNumbers.get(post.id) ?? 0, noteNumber: noteNumbers.get(post.id), focused: post.id === focusedPostId }
              : undefined
          }
          voiceBet={voiceBet?.postId === post.id ? voiceBet : undefined}
        />
      ))}
      <VoiceBar on={voiceOn} onToggle={setVoiceOn} screen={screen} onCommand={runCommand} onTarget={showCard} />
      {visible.length === 0 && <p className="xt-foot muted">No posts here yet.</p>}
      <MorePosts />
      {!xPostsMore && (
        <p className="xt-foot muted">
          {xPostsState === 'loading' && 'Loading the posts from X…'}
          {xPostsState === 'error' && 'The posts from X are not available now.'}
          {xPostsState === 'ready' && X_POSTS_LINE}
        </p>
      )}
    </>
  );
}

/**
 * The end of the loaded posts, while the route has more: when the visitor scrolls to it, it shows
 * a spinner and the next page (X_PAGE_SIZE posts) loads. After each page the line is watched
 * again, so a short page that leaves it in sight loads the next one too.
 */
function MorePosts() {
  const { xPosts, xPostsMore, xPostsMoreState, loadMoreXPosts } = useDemo();
  const line = useRef<HTMLDivElement>(null);
  const load = useRef(loadMoreXPosts);
  useEffect(() => {
    load.current = loadMoreXPosts;
  });
  useEffect(() => {
    const element = line.current;
    if (!element || !xPostsMore || xPostsMoreState !== 'idle') return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) load.current();
      },
      // The element that scrolls is the root: the window's own edge is far below. Its bottom 88 px
      // are under the voice bar, so the line counts only above the bar, where its spinner shows.
      { root: scrollParent(element), rootMargin: '0px 0px -88px 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [xPostsMore, xPostsMoreState, xPosts.length]);
  if (!xPostsMore) return null;
  return (
    <div ref={line} className="xt-more-posts" aria-live="polite">
      {xPostsMoreState === 'error' ? (
        <>
          The next posts did not load.{' '}
          <button type="button" className="link-btn" onClick={() => loadMoreXPosts()}>
            Try again
          </button>
        </>
      ) : (
        <span className="muted">
          <span className="spinner" aria-hidden="true" /> Loading more posts…
        </span>
      )}
    </div>
  );
}

/** The id of a post's card, so that the voice feed can bring it into view. */
export const postCardId = (postId: number) => `post-${postId}`;

function PostCard({
  post,
  note,
  market,
  voice,
  voiceBet,
}: {
  post: Post;
  note: CardNote | null;
  market: NoteMarket | null | undefined;
  /** With the voice bar on: the numbers that the visitor can say, and "this one". */
  voice?: { number: number; noteNumber?: number; focused: boolean };
  /** A bet on this post's note that a voice command asked for. */
  voiceBet?: VoiceBet;
}) {
  const { openWrite } = useDemo();
  // The bet dialog of the demo post's context, open in place. `bet`: a voice command's bet.
  const [betting, setBetting] = useState<{ bet?: { side: Side; amount: bigint | null } } | null>(null);
  // Starts a bet on a note of this app (its market strip): a click on the card, or a voice command.
  const [betRequest, setBetRequest] = useState<BetRequest>();
  useEffect(() => {
    if (!voiceBet) return;
    if (post.context) setBetting({ bet: voiceBet.bet });
    else setBetRequest(voiceBet.request);
    // Each voice bet is a new object, and it runs once.
  }, [voiceBet]);
  // A post has no page: a click opens the bet when its market takes bets, else the write dialog.
  const open = () => {
    if (post.context) setBetting({});
    else if (note?.note && marketTab(market, Date.now()) === 'open') setBetRequest({ seq: nextBetSeq() });
    else openWrite(post.id);
  };
  return (
    <article
      id={postCardId(post.id)}
      className={voice?.focused ? 'tl-post voice-focus' : 'tl-post'}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target === event.currentTarget) open();
      }}
      tabIndex={0}
      aria-label={`Post by ${post.author.name}`}
    >
      <Avatar author={post.author} />
      <div className="tl-main">
        <div className="tl-head">
          <b className="name">{post.author.name}</b>
          <AuthorBadge author={post.author} />
          <span className="handle muted">@{post.author.handle}</span>
          <span className="muted xt-age">· {post.age}</span>
          <span className="xt-topic">{post.topic ?? 'Demo'}</span>
          {voice && (
            <span className="voice-number" aria-label={`Post ${voice.number}`}>
              {voice.number}
            </span>
          )}
        </div>
        <div className={post.linkify ? 'tl-text xt-text' : 'tl-text'}>
          <PostText post={post} />
        </div>
        {post.media && <Media kind={post.media} caption={post.mediaCaption} compact />}
        {post.image && <img className="xt-media" src={post.image.url} alt={post.image.alt} loading="lazy" referrerPolicy="no-referrer" />}
        {note ? (
          <NoteBox note={note} market={market} onBet={() => setBetting({})} betRequest={betRequest} number={voice?.noteNumber} />
        ) : (
          <div className="xt-box xt-empty xt-row">
            <IconUsers size={20} stroke={1.8} className="muted" aria-hidden="true" />
            <div className="xt-row-text">
              <b>No note yet</b>
              <div className="muted small">Write the first note with your voice.</div>
            </div>
            {/* The write dialog opens here, over the timeline: no stop at the post page. */}
            <button
              type="button"
              className="btn btn-blue btn-sm"
              onClick={(event) => {
                event.stopPropagation();
                openWrite(post.id);
              }}
            >
              Write a note
            </button>
          </div>
        )}
        <ActionRow post={post} showViews />
      </div>
      {betting && post.context && (
        // A dialog is a child of the card in React, so its clicks must not reach the card. The
        // wrapper makes no box (display: contents): as a box it was a third column of the card,
        // and the card's text moved 12 px to the left while the dialog was open. Keys pass: the
        // dialog hears Escape and Tab on the document, and the card answers only its own Enter.
        <div style={{ display: 'contents' }} onClick={(event) => event.stopPropagation()}>
          <NoteDialog post={post} context={post.context} bet={betting.bet} onClose={() => setBetting(null)} />
        </div>
      )}
    </article>
  );
}

/** A note is long enough to cut at two lines on a card. */
const LONG_NOTE_CHARS = 150;

/**
 * The note of a card and its market. A long note, or a note with more lines of detail, shows two
 * lines and opens in place. The bet happens here too: the demo post's context opens its bet
 * dialog, and a note of this app has its market strip, which opens the bet sheet. A note of this
 * app has its rating line ("Rate it") too, and a new note flashes.
 */
function NoteBox({
  note,
  market,
  onBet,
  betRequest,
  number,
}: {
  note: CardNote;
  market: NoteMarket | null | undefined;
  onBet: () => void;
  /** Starts a bet in the strip. */
  betRequest: BetRequest | undefined;
  /** The note's number for a voice command ("the second note"), while the voice bar is on. */
  number?: number;
}) {
  const { account, prepare, freshNoteId } = useDemo();
  const source = useMarketSource();
  const betVoice = useBetVoice(source);
  const [expanded, setExpanded] = useState(false);
  const state = marketTab(market, Date.now());
  const pool = market ? amountText(market.yesPool + market.noPool, source.currency) : '';
  const more = note.details.length > 0 || [...note.text].length > LONG_NOTE_CHARS;
  return (
    <div className={note.note && note.note.id === freshNoteId ? 'xt-box note-fresh' : 'xt-box'} onClick={(event) => event.stopPropagation()}>
      <div className="xt-box-head">
        <IconUsers size={18} stroke={1.8} aria-hidden="true" />
        {number !== undefined && <span className="voice-number">Note {number}</span>}
        {note.shown ? 'Readers added context' : 'Proposed note'}
        {!note.shown && <span className="xt-state">needs ratings</span>}
      </div>
      <p className={expanded || !more ? 'xt-note xt-note-open' : 'xt-note'}>{note.text}</p>
      {expanded && note.details.length > 0 && (
        <ol className="pc-examples xt-details">
          {note.details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ol>
      )}
      {more && (
        <button type="button" className="xt-more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show less' : 'Show more'}
          <IconChevronDown size={15} stroke={2.2} className={expanded ? 'xt-more-up' : ''} aria-hidden="true" />
        </button>
      )}
      {note.note && <NoteRateLine note={note.note} />}
      {note.note ? (
        // A note of this app: its market strip, with its bet and open sheets.
        <NoteMarketStrip
          noteId={note.marketNoteId}
          source={source}
          account={account}
          onSignIn={() => prepare({ funds: 'bet', voice: source.signsByVoice || betVoice !== null }).then((ready) => ready.ok)}
          context={marketContext(note.note)}
          openBet={betRequest}
        />
      ) : (
        <div className="xt-market">
          {market && state && <Bar yesBps={state === 'decided' ? (market.verdictBps ?? 5_000) : yesShareBps(market.yesPool, market.noPool)} />}
          <div className="xt-row">
            {market === undefined && <span className="xt-row-text muted">Reading the market…</span>}
            {market === null && <span className="xt-row-text muted">No market on this note yet.</span>}
            {market && state === 'open' && (
              <>
                <span className="xt-row-text">
                  <b>{market.question}</b>{' '}
                  <span className="muted">
                    {percentText(yesShareBps(market.yesPool, market.noPool))} yes · {pool} · {market.bets} {market.bets === 1 ? 'bet' : 'bets'} ·{' '}
                    {timeLeftText(market.closesAtMs)}
                  </span>
                </span>
                <button type="button" className="btn btn-blue btn-sm" onClick={onBet}>
                  Bet
                </button>
              </>
            )}
            {market && state === 'closed' && (
              <>
                <span className="xt-row-text">
                  <b>Betting is closed.</b> <span className="muted">{pool} waits for JEV.</span>
                </span>
                <button type="button" className="btn btn-outline btn-sm" onClick={onBet}>
                  See the market
                </button>
              </>
            )}
            {market && state === 'decided' && (
              <span className="xt-row-text">
                <span className="xt-verdict">{jevSentence(market.verdictBps ?? 5_000)}</span> <span className="muted">Pool: {pool}.</span>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Bar({ yesBps }: { yesBps: number }) {
  const yes = Math.max(0, Math.min(100, yesBps / 100));
  return (
    <div className="nm-bar" role="img" aria-label={`${Math.round(yes)}% yes, ${Math.round(100 - yes)}% no`}>
      <span className="nm-bar-yes" style={{ width: `${yes}%` }} />
      <span className="nm-bar-no" style={{ width: `${100 - yes}%` }} />
    </div>
  );
}
