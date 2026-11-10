// The timeline of the notes app: the demo post and the posts from X that can get a note, each
// with its note and the state of its market. A card opens the post page, where the visitor
// writes, rates and bets.

import { useEffect, useMemo, useState } from 'react';
import { IconUsers } from '@tabler/icons-react';
import { ActionRow, AuthorBadge, Avatar, Media, PostText } from '../components/bits';
import { shownNote } from '../components/NotesBox';
import { CONTEXT_MARKET_NOTE_ID } from '../components/PostContext';
import { POSTS, type Post } from '../data/posts';
import { useDemo } from '../demoContext';
import { useMarketSource } from '../market/contractSource';
import { amountText, jevSentence, percentText, timeLeftText, yesShareBps } from '../market/math';
import type { NoteMarket } from '../market/types';
import type { Note } from '../notes/types';
import { navigate, paths } from '../router';
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
  /** False for a note that still needs ratings. */
  shown: boolean;
}

/** The demo post shows the note that it got on X. Another post shows its best note of this app. */
export function cardNote(post: Post, notes: Note[]): CardNote | null {
  if (post.context) return { marketNoteId: CONTEXT_MARKET_NOTE_ID, text: post.context.text, shown: true };
  const note = shownNote(notes) ?? [...notes].sort((a, b) => b.helpful - a.helpful || a.id - b.id)[0];
  return note ? { marketNoteId: note.id, text: note.text, shown: note.status === 'helpful' } : null;
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
      <header className="page-head">
        <h1>Needs context</h1>
      </header>
      <p className="xt-sub muted">Posts where readers on X asked for a note. Write the note, then bet on it.</p>
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

function PostCard({ post, note, market }: { post: Post; note: CardNote | null; market: NoteMarket | null | undefined }) {
  const { openWrite } = useDemo();
  const open = () => navigate(paths.post(post.id));
  return (
    <article
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
          <NoteBox note={note} market={market} onOpen={open} />
        ) : (
          <div className="xt-box xt-empty xt-row">
            <IconUsers size={20} stroke={1.8} className="muted" aria-hidden="true" />
            <div className="xt-row-text">
              <b>No note yet</b>
              <div className="muted small">Write the first note with your voice.</div>
            </div>
            <button
              type="button"
              className="btn btn-blue btn-sm"
              onClick={(event) => {
                event.stopPropagation();
                open();
                openWrite(post.id);
              }}
            >
              Write a note
            </button>
          </div>
        )}
        <ActionRow post={post} showViews />
      </div>
    </article>
  );
}

function NoteBox({ note, market, onOpen }: { note: CardNote; market: NoteMarket | null | undefined; onOpen: () => void }) {
  const source = useMarketSource();
  const state = marketTab(market, Date.now());
  const pool = market ? amountText(market.yesPool + market.noPool, source.currency) : '';
  const go = (label: string, kind: 'btn-blue' | 'btn-outline') => (
    <button
      type="button"
      className={`btn ${kind} btn-sm`}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
    >
      {label}
    </button>
  );
  return (
    <div className="xt-box">
      <div className="xt-box-head">
        <IconUsers size={18} stroke={1.8} aria-hidden="true" />
        {note.shown ? 'Readers added context' : 'Proposed note'}
        {!note.shown && <span className="xt-state">needs ratings</span>}
      </div>
      <p className="xt-note">{note.text}</p>
      <div className="xt-market">
        {market && state && <Bar yesBps={state === 'decided' ? (market.verdictBps ?? 5_000) : yesShareBps(market.yesPool, market.noPool)} />}
        <div className="xt-row">
          {market === undefined && <span className="xt-row-text muted">Reading the market…</span>}
          {market === null && (
            <>
              <span className="xt-row-text muted">No market on this note yet.</span>
              {go('Open a market', 'btn-outline')}
            </>
          )}
          {market && state === 'open' && (
            <>
              <span className="xt-row-text">
                <b>{market.question}</b>{' '}
                <span className="muted">
                  {percentText(yesShareBps(market.yesPool, market.noPool))} yes · {pool} · {market.bets} {market.bets === 1 ? 'bet' : 'bets'} ·{' '}
                  {timeLeftText(market.closesAtMs)}
                </span>
              </span>
              {go('Bet', 'btn-blue')}
            </>
          )}
          {market && state === 'closed' && (
            <>
              <span className="xt-row-text">
                <b>Betting is closed.</b> <span className="muted">{pool} waits for JEV.</span>
              </span>
              {go('See the market', 'btn-outline')}
            </>
          )}
          {market && state === 'decided' && (
            <span className="xt-row-text">
              <span className="xt-verdict">{jevSentence(market.verdictBps ?? 5_000)}</span> <span className="muted">Pool: {pool}.</span>
            </span>
          )}
        </div>
      </div>
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
