// Dev-only mock of the timeline: X posts that can get a Community Note, each with its note and
// market state. Open /timeline-preview.html in `pnpm dev`. The posts are real (src/x/fixture.ts).
// The notes, markets and their numbers are examples, to show each state of a card.

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { IconBookmark, IconChartBar, IconHeart, IconMessageCircle, IconRepeat, IconRosetteDiscountCheckFilled, IconUpload, IconUsers } from '@tabler/icons-react';
import type { XPost } from './types';
import { Linkified } from '../components/bits';
import { FIXTURE_FETCHED_AT_MS, FIXTURE_POSTS } from './fixture';
import { X_POSTS_LINE } from './xPosts';
import '../styles.css';
import '../market/market.css';
import './timeline.css';

/** What the demo knows about a post. In the product it comes from the notes and market contracts. */
type CardState =
  | { kind: 'none' }
  | { kind: 'note'; note: string; notes: number }
  | { kind: 'open'; note: string; yesPercent: number; pool: string; bets: number; left: string }
  | { kind: 'decided'; note: string; verdictPercent: number; pool: string };

const EXAMPLE_STATES: Record<string, CardState> = {
  '2120014542000570602': {
    kind: 'open',
    note: 'The post compares 2 games of one player with 5 games of the other. Per game, the two totals are far apart.',
    yesPercent: 71,
    pool: '6.5',
    bets: 9,
    left: '2 h 10 min left',
  },
  '2119918368736088126': {
    kind: 'decided',
    note: 'Marthe Gautier did the cell work that showed the extra chromosome in 1958. The 1959 paper listed Jérôme Lejeune as first author.',
    verdictPercent: 88,
    pool: '12.4',
  },
  '2119872309796442122': {
    kind: 'note',
    note: 'The link is a commentary video. The post gives no statement from the studio.',
    notes: 1,
  },
};

type Tab = 'fresh' | 'open' | 'decided';
const TABS: { id: Tab; label: string }[] = [
  { id: 'fresh', label: 'Fresh' },
  { id: 'open', label: 'Open markets' },
  { id: 'decided', label: 'Decided' },
];

function stateOf(post: XPost): CardState {
  return EXAMPLE_STATES[post.id] ?? { kind: 'none' };
}

function Preview() {
  const [tab, setTab] = useState<Tab>('fresh');
  const posts = FIXTURE_POSTS.filter((post) => tab === 'fresh' || stateOf(post).kind === tab);
  return (
    <div className="notes-app" style={{ height: '100vh', overflowY: 'auto' }}>
      <div className="layout">
        <main className="column">
          <p className="xt-mock">
            Mock. The posts are real posts from X (10 Nov). The notes, markets and numbers under them are examples.
          </p>
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
          {posts.map((post) => (
            <PostCard key={post.id} post={post} state={stateOf(post)} />
          ))}
          {posts.length === 0 && <p className="xt-foot muted">No posts here yet.</p>}
          <p className="xt-foot muted">{X_POSTS_LINE}</p>
        </main>
      </div>
    </div>
  );
}

function PostCard({ post, state }: { post: XPost; state: CardState }) {
  const photo = post.media[0];
  return (
    <article className="tl-post">
      {post.author?.avatarUrl ? <img className="xt-avatar" src={post.author.avatarUrl} alt="" /> : <span className="xt-avatar" />}
      <div className="tl-main">
        <div className="tl-head">
          <b className="name">{post.author?.name ?? 'X user'}</b>
          {post.author?.verified && <IconRosetteDiscountCheckFilled className="badge badge-blue" size={18} aria-label="Verified" />}
          <span className="handle muted">@{post.author?.username ?? 'unknown'}</span>
          <span className="muted">· {timeAgo(post.createdAt)}</span>
          {post.topic && <span className="xt-topic">{post.topic}</span>}
        </div>
        <div className="tl-text xt-text">
          <Linkified text={post.text} />
        </div>
        {photo && <img className="xt-media" src={photo.url} alt={photo.alt ?? ''} loading="lazy" />}
        <StateBox state={state} />
        <Counts post={post} />
      </div>
    </article>
  );
}

function StateBox({ state }: { state: CardState }) {
  if (state.kind === 'none') {
    return (
      <div className="xt-box xt-empty xt-row">
        <IconUsers size={20} stroke={1.8} className="muted" aria-hidden="true" />
        <div className="xt-row-text">
          <b>No note yet</b>
          <div className="muted small">Write the first note with your voice.</div>
        </div>
        <button type="button" className="btn btn-blue btn-sm">
          Write a note
        </button>
      </div>
    );
  }
  return (
    <div className="xt-box">
      <div className="xt-box-head">
        <IconUsers size={18} stroke={1.8} aria-hidden="true" />
        Readers added context
      </div>
      <p className="xt-note">{state.note}</p>
      <div className="xt-market">
        {state.kind === 'note' && (
          <div className="xt-row">
            <span className="xt-row-text muted">No market on this note yet.</span>
            <button type="button" className="btn btn-outline btn-sm">
              Open a market
            </button>
          </div>
        )}
        {state.kind === 'open' && (
          <>
            <Bar yes={state.yesPercent} />
            <div className="xt-row">
              <span className="xt-row-text">
                <b>Is this note true?</b>{' '}
                <span className="muted">
                  {state.yesPercent}% yes · {state.pool} USDC · {state.bets} bets · {state.left}
                </span>
              </span>
              <span className="xt-btns">
                <button type="button" className="btn btn-outline btn-sm">
                  Bet yes
                </button>
                <button type="button" className="btn btn-outline btn-sm">
                  Bet no
                </button>
              </span>
            </div>
          </>
        )}
        {state.kind === 'decided' && (
          <>
            <Bar yes={state.verdictPercent} />
            <div className="xt-row">
              <span className="xt-row-text">
                <span className="xt-verdict">JEV: the note is true ({state.verdictPercent}%).</span>{' '}
                <span className="muted">{state.pool} USDC paid out.</span>
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Bar({ yes }: { yes: number }) {
  return (
    <div className="nm-bar" role="img" aria-label={`${yes}% yes, ${100 - yes}% no`}>
      <span className="nm-bar-yes" style={{ width: `${yes}%` }} />
      <span className="nm-bar-no" style={{ width: `${100 - yes}%` }} />
    </div>
  );
}

/** The post's real counts from X. The buttons copy the look only. */
function Counts({ post }: { post: XPost }) {
  const metrics = post.metrics;
  const items = [
    { tone: 'blue', icon: <IconMessageCircle size={19} stroke={1.6} />, count: metrics?.replies },
    { tone: 'green', icon: <IconRepeat size={19} stroke={1.6} />, count: metrics?.reposts },
    { tone: 'pink', icon: <IconHeart size={19} stroke={1.6} />, count: metrics?.likes },
    { tone: 'blue', icon: <IconChartBar size={19} stroke={1.6} />, count: metrics?.views },
  ];
  return (
    <div className="actions" aria-hidden="true">
      {items.map((item, index) => (
        <span key={index} className={`act act-${item.tone}`}>
          <span className="act-icon">{item.icon}</span>
          {item.count !== undefined && <span className="act-count">{compact(item.count)}</span>}
        </span>
      ))}
      <span className="act-end">
        <span className="act act-blue">
          <span className="act-icon">
            <IconBookmark size={19} stroke={1.6} />
          </span>
        </span>
        <span className="act act-blue">
          <span className="act-icon">
            <IconUpload size={19} stroke={1.6} />
          </span>
        </span>
      </span>
    </div>
  );
}

function compact(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(count >= 10_000 ? 0 : 1).replace(/\.0$/, '')}K`;
  return String(count);
}

/** The age of the post at the time of the X call, as X shows it: "2h", "3d". */
function timeAgo(createdAt: string | null): string {
  if (!createdAt) return '';
  const minutes = Math.max(1, Math.round((FIXTURE_FETCHED_AT_MS - Date.parse(createdAt)) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / (24 * 60))}d`;
}

const root = document.getElementById('root');
if (!root) throw new Error('The page has no #root element.');
createRoot(root).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
