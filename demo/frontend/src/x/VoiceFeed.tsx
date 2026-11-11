// The right column of the notes app, in the order of X's own right column:
// - a search box, for the look only: it takes no click and no key;
// - "Signed by voice": the newest notes, each with the sentence that its author said to post it.
//   It shows only when there is a note.

import { IconMicrophone, IconSearch } from '@tabler/icons-react';
import { shortAccount } from '../config';
import { findPost } from '../data/posts';
import { useDemo } from '../demoContext';
import type { Note } from '../notes/types';
import { postCardId, showCard } from './Timeline';

const MAX_ROWS = 6;

/** The newest notes of all posts, newest first. */
export function newestNotes(notesByPost: Record<number, Note[]>, limit = MAX_ROWS): Note[] {
  return Object.values(notesByPost)
    .flat()
    .sort((a, b) => b.created_at_ms - a.created_at_ms || b.id - a.id)
    .slice(0, limit);
}

export function VoiceFeed() {
  const { notesByPost } = useDemo();
  const notes = newestNotes(notesByPost);
  return (
    <aside className="side xt-side" aria-label="About voice signatures">
      {/* For the look only, as on X. Screen readers and the keyboard pass over it. */}
      <div className="side-search xt-search" aria-hidden="true">
        <IconSearch size={18} stroke={1.8} />
        <span>Search</span>
      </div>
      {notes.length > 0 && (
        <section className="side-box" aria-labelledby="voice-feed-title">
          <h2 id="voice-feed-title" className="side-title">
            Signed by voice
          </h2>
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
        </section>
      )}
    </aside>
  );
}
