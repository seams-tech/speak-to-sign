// The right column of the notes app, in the order of X's own right column:
// - a search box, for the look only: it takes no click and no key;
// - "Your bets": the markets where the signed-in account has a stake (MyBets.tsx);
// - "Signed by voice": the newest notes, each with the sentence that its author said to post it,
//   and a link to the transaction that added it. It shows only when there is a note.

import { useEffect, useState } from 'react';
import { IconMicrophone, IconSearch } from '@tabler/icons-react';
import { TxLink } from '../components/bits';
import { config, shortAccount } from '../config';
import { findPost } from '../data/posts';
import { useDemo } from '../demoContext';
import { findNoteTransactions } from '../notes/noteTransactions';
import type { Note } from '../notes/types';
import { MyBets } from './MyBets';
import { postCardId, showCard } from './Timeline';

const MAX_ROWS = 6;

/** The newest notes of all posts, newest first. */
export function newestNotes(notesByPost: Record<number, Note[]>, limit = MAX_ROWS): Note[] {
  return Object.values(notesByPost)
    .flat()
    .sort((a, b) => b.created_at_ms - a.created_at_ms || b.id - a.id)
    .slice(0, limit);
}

/**
 * The transaction of each note in `notes`: the ones that this page sent, and the others from the
 * transactions API. It asks again when a note with no known transaction comes.
 */
function useNoteTransactions(notes: Note[]): Record<number, string> {
  const { noteTx } = useDemo();
  const [found, setFound] = useState<Record<number, string>>({});
  const missing = notes
    .filter((note) => !noteTx[note.id] && !found[note.id])
    .map((note) => note.id)
    .join(',');
  useEffect(() => {
    if (missing === '') return;
    const controller = new AbortController();
    findNoteTransactions(config.txApiUrl, config.contract, controller.signal)
      .then((more) => setFound((current) => ({ ...more, ...current })))
      // No link is a fine result: the card stays as it is.
      .catch(() => undefined);
    return () => controller.abort();
  }, [missing]);
  return { ...found, ...noteTx };
}

export function VoiceFeed() {
  const { notesByPost } = useDemo();
  const notes = newestNotes(notesByPost);
  const transactions = useNoteTransactions(notes);
  return (
    <aside className="side xt-side" aria-label="About voice signatures">
      {/* For the look only, as on X. Screen readers and the keyboard pass over it. */}
      <div className="side-search xt-search" aria-hidden="true">
        <IconSearch size={18} stroke={1.8} />
        <span>Search</span>
      </div>
      <MyBets />
      {notes.length > 0 && (
        <section className="side-box" aria-labelledby="voice-feed-title">
          <h2 id="voice-feed-title" className="side-title">
            Signed by voice
          </h2>
          <ul className="trend-list">
            {notes.map((note) => (
              <li key={note.id} className="trend-item">
                {/* The post has no page: its card in the timeline comes into view and flashes. */}
                <a
                  className="trend"
                  href={`#${postCardId(note.post_id)}`}
                  onClick={(event) => {
                    event.preventDefault();
                    showCard(note.post_id);
                  }}
                >
                  <span className="trend-kicker">
                    <IconMicrophone size={13} stroke={2} aria-hidden="true" /> {shortAccount(note.author)} said
                  </span>
                  <span className="trend-title">“{note.summary}”</span>
                  <span className="trend-meta muted">A note on the post of {findPost(note.post_id)?.author.name ?? 'an X user'}</span>
                </a>
                {/* Outside the row's link: a link cannot hold another link. */}
                {transactions[note.id] && (
                  <span className="trend-tx">
                    <TxLink hash={transactions[note.id]!} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
