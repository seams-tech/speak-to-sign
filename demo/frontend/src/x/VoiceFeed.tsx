// The right column of the notes app: the newest notes, each with the sentence that its author
// said to post it. It shows what a voice signature leaves on chain.

import { IconMicrophone } from '@tabler/icons-react';
import { shortAccount } from '../config';
import { findPost } from '../data/posts';
import { useDemo } from '../demoContext';
import type { Note } from '../notes/types';
import { postCardId } from './Timeline';

const MAX_ROWS = 6;

/** Brings a post's card into view in the timeline, and flashes it. */
function showCard(postId: number) {
  const card = document.getElementById(postCardId(postId));
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.classList.remove('note-fresh');
  // A new frame restarts the flash when the same card is chosen twice.
  requestAnimationFrame(() => card.classList.add('note-fresh'));
  window.setTimeout(() => card.classList.remove('note-fresh'), 2400);
}

/** The newest notes of all posts, newest first. */
export function newestNotes(notesByPost: Record<number, Note[]>, limit = MAX_ROWS): Note[] {
  return Object.values(notesByPost)
    .flat()
    .sort((a, b) => b.created_at_ms - a.created_at_ms || b.id - a.id)
    .slice(0, limit);
}

export function VoiceFeed() {
  const { notesByPost, loading } = useDemo();
  const notes = newestNotes(notesByPost);
  return (
    <aside className="side xt-side" aria-labelledby="voice-feed-title">
      <section className="side-box">
        <h2 id="voice-feed-title" className="side-title">
          Signed by voice
        </h2>
        {notes.length === 0 ? (
          <p className="side-empty muted">{loading ? 'Reading notes from testnet…' : 'No notes yet. Click a post and write the first one with your voice.'}</p>
        ) : (
          <ul className="trend-list">
            {notes.map((note) => (
              <li key={note.id}>
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
              </li>
            ))}
          </ul>
        )}
        <p className="side-text muted xt-side-foot">Each note was posted with a spoken sentence. The Wallet signed only that one call.</p>
      </section>
    </aside>
  );
}
