// The timeline of the notes app: the demo post and the posts from X that can get a note, each
// with its note and the state of its market. The timeline is the app's one view: the visitor
// writes, rates and bets on the card itself, and the dialogs open over the timeline. A click on
// a card opens its bet (when its market takes bets) or the write dialog.

import { useEffect, useMemo, useState } from 'react';
import { IconChevronDown, IconUsers } from '@tabler/icons-react';
import { ActionRow, AuthorBadge, Avatar, Media, PostText } from '../components/bits';
import { NoteRateLine, shownNote } from '../components/NotesBox';
import { CONTEXT_MARKET_NOTE_ID, NoteDialog } from '../components/PostContext';
import { POSTS, type Post } from '../data/posts';
import { useDemo } from '../demoContext';
import { useMarketSource } from '../market/contractSource';
import { amountText, jevSentence, percentText, timeLeftText, yesShareBps } from '../market/math';
import { NoteMarketStrip } from '../market/NoteMarket';
import { marketContext } from '../market/noteContext';
import type { NoteMarket } from '../market/types';
import type { Note } from '../notes/types';
import './timeline.css';

type Tab = 'fresh' | 'open' | 'decided';
const TABS: { id: Tab; label: string }[] = [
  { id: 'fresh', label: 'Fresh' },
  { id: 'open', label: 'Open markets' },
  { id: 'decided', label: 'Decided' },
];

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

export function Timeline() {
  const { notesByPost, xPosts, xPostsState } = useDemo();
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

  const visible = cards.filter((card) => tab === 'fresh' || marketTab(card.note ? markets[card.note.marketNoteId] : null, now) === tab);

  return (
    <>
      <h1 className="sr-only">Posts that need context</h1>
      <nav className="tabs" aria-label="Timeline">
        {TABS.map(({ id, label }) => (
          <button key={id} type="button" className={`tab ${tab === id ? 'tab-on' : ''}`} aria-current={tab === id} onClick={() => setTab(id)}>
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {visible.map(({ post, note }) => (
        <PostCard key={post.id} post={post} note={note} market={note ? markets[note.marketNoteId] : null} />
      ))}
      {visible.length === 0 && <p className="xt-foot muted">No posts here yet.</p>}
      <p className="xt-foot muted">
        {xPostsState === 'loading' && 'Loading the posts from X…'}
        {xPostsState === 'error' && 'The posts from X are not available now.'}
        {xPostsState === 'ready' && 'New posts from X 3 times a day. Sport, science, technology, business and entertainment only.'}
      </p>
    </>
  );
}

/** The id of a post's card, so that the voice feed can bring it into view. */
export const postCardId = (postId: number) => `post-${postId}`;

function PostCard({ post, note, market }: { post: Post; note: CardNote | null; market: NoteMarket | null | undefined }) {
  const { openWrite } = useDemo();
  // The bet dialog of the demo post's context, open in place.
  const [betting, setBetting] = useState(false);
  // Goes up to open the bet sheet of a note of this app (its market strip).
  const [betRequest, setBetRequest] = useState(0);
  // A post has no page: a click opens the bet when its market takes bets, else the write dialog.
  const open = () => {
    if (post.context) setBetting(true);
    else if (note?.note && marketTab(market, Date.now()) === 'open') setBetRequest((count) => count + 1);
    else openWrite(post.id);
  };
  return (
    <article
      id={postCardId(post.id)}
      className="tl-post"
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
        </div>
        <div className={post.linkify ? 'tl-text xt-text' : 'tl-text'}>
          <PostText post={post} />
        </div>
        {post.media && <Media kind={post.media} caption={post.mediaCaption} compact />}
        {post.image && <img className="xt-media" src={post.image.url} alt={post.image.alt} loading="lazy" referrerPolicy="no-referrer" />}
        {note ? (
          <NoteBox note={note} market={market} onBet={() => setBetting(true)} betRequest={betRequest} />
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
          <NoteDialog post={post} context={post.context} onClose={() => setBetting(false)} />
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
}: {
  note: CardNote;
  market: NoteMarket | null | undefined;
  onBet: () => void;
  /** Goes up to open the strip's bet sheet. */
  betRequest: number;
}) {
  const { account, prepare, freshNoteId } = useDemo();
  const source = useMarketSource();
  const [expanded, setExpanded] = useState(false);
  const state = marketTab(market, Date.now());
  const pool = market ? amountText(market.yesPool + market.noPool, source.currency) : '';
  const more = note.details.length > 0 || [...note.text].length > LONG_NOTE_CHARS;
  return (
    <div className={note.note && note.note.id === freshNoteId ? 'xt-box note-fresh' : 'xt-box'} onClick={(event) => event.stopPropagation()}>
      <div className="xt-box-head">
        <IconUsers size={18} stroke={1.8} aria-hidden="true" />
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
          onSignIn={() => prepare({ funds: 'bet' }).then((ready) => ready.ok)}
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
