// The Community Note that the post got on X, shown as on X: "Readers added context". In place of
// "Do you find this helpful?", it asks for a bet. The Bet button opens the note, as X's note
// view does, with the note market at its foot.

import { useId, useState } from 'react';
import { IconCircleCheckFilled, IconExternalLink, IconUsers, IconX } from '@tabler/icons-react';
import type { Post, PostContext as Context } from '../data/posts';
import { useDemo } from '../demoContext';
import { NoteMarketStrip } from '../market/NoteMarket';
import { createMockMarketSource } from '../market/mockSource';
import type { MarketSource } from '../market/types';
import { MediaThumb } from './Media';
import { Modal } from './Modal';

/** The context is not a note on the notes contract, so its market has a fixed note id. */
export const CONTEXT_MARKET_NOTE_ID = 0;

/** The market question. Yes is "true", no is "false". */
const QUESTION = 'Is this note true?';

/**
 * A practice market (in this browser only) until the JEV prediction market contract is on
 * testnet. Then this source becomes the contract source (see src/market/README.md).
 */
const contextMarketSource: MarketSource = withQuestion(
  createMockMarketSource({ noteIds: [CONTEXT_MARKET_NOTE_ID], signsByVoice: false }),
  QUESTION,
);
const PRACTICE = true;

function withQuestion(source: MarketSource, question: string): MarketSource {
  return {
    ...source,
    async getMarketForNote(noteId) {
      const market = await source.getMarketForNote(noteId);
      return market && { ...market, question };
    },
  };
}

export function PostContextBox({ post }: { post: Post }) {
  const [open, setOpen] = useState(false);
  const context = post.context;
  if (!context) return null;
  return (
    <>
      <section className="note-card pc-card" aria-label="Readers added context">
        <header className="note-head">
          <IconUsers size={20} stroke={1.8} className="note-icon-shown" aria-hidden="true" />
          <b>Readers added context they thought people might want to know</b>
        </header>
        <div className="note-body">
          <ContextText context={context} source={post.history.source} />
        </div>
        <div className="note-foot note-rate">
          <span>Do you bet this is true or false?</span>
          <button type="button" className="btn btn-blue" onClick={() => setOpen(true)}>
            Bet
          </button>
        </div>
      </section>
      {open && <NoteDialog post={post} context={context} onClose={() => setOpen(false)} />}
    </>
  );
}

function ContextText({ context, source }: { context: Context; source: Post['history']['source'] }) {
  return (
    <>
      <p>{context.text}</p>
      <ol className="pc-examples">
        {context.examples.map((example) => (
          <li key={example}>{example}</li>
        ))}
      </ol>
      <a className="lk pc-source" href={source.url} target="_blank" rel="noopener noreferrer" title={source.title}>
        Source
        <IconExternalLink size={13} stroke={1.8} aria-hidden="true" />
      </a>
    </>
  );
}

/** The note view, kept short: the quoted post, the note, then the bet with two colored buttons. */
function NoteDialog({ post, context, onClose }: { post: Post; context: Context; onClose: () => void }) {
  const { account, openSignIn } = useDemo();
  const titleId = useId();
  return (
    <Modal labelledBy={titleId} onClose={onClose} locked={false}>
      <header className="dialog-head">
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          <IconX size={20} />
        </button>
        <h2 id={titleId}>Note</h2>
      </header>
      <div className="dialog-body">
        <div className="pc-note">
          <div className="pc-post pc-post-row">
            {post.media && <MediaThumb kind={post.media} />}
            <div className="pc-post-main">
              <div className="pc-post-head">
                <b>{post.author.name}</b>
                <span className="muted">
                  @{post.author.handle} · {post.age}
                </span>
              </div>
              <p className="pc-post-text">{post.text}</p>
            </div>
          </div>
          <div className="pc-status">
            <p className="pc-status-row">
              <IconCircleCheckFilled size={18} className="pc-ok" aria-hidden="true" />
              <b>Rated helpful on X</b>
            </p>
            <p className="pc-note-text">
              {context.text}{' '}
              <a className="lk pc-source" href={post.history.source.url} target="_blank" rel="noopener noreferrer" title={post.history.source.title}>
                Source
                <IconExternalLink size={13} stroke={1.8} aria-hidden="true" />
              </a>
            </p>
          </div>
          <div className="pc-bet">
            <b className="pc-bet-title">Is this note true?</b>
            <NoteMarketStrip
              noteId={CONTEXT_MARKET_NOTE_ID}
              source={contextMarketSource}
              account={account}
              onSignIn={openSignIn}
              directBet
            />
            <p className="pc-practice">
              {PRACTICE
                ? 'One tap bets 0.5 NEAR. Practice market: bets stay in this browser until this note has a market on testnet.'
                : 'One tap places one bet. Your Seams Wallet asks you to confirm.'}
            </p>
          </div>
        </div>
      </div>
    </Modal>
  );
}
