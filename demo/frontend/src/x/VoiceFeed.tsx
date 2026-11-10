// The right column of the notes app, in the order of X's own right column:
// - a search box, for the look only: it takes no click and no key;
// - "Why sign by voice?": three short reasons, in the place of X's news box;
// - "Signed by voice": the newest notes, each with the sentence that its author said to post it.
//   It shows only when there is a note.

import type { ReactNode } from 'react';
import { IconEyeCheck, IconHandOff, IconMicrophone, IconRobotOff, IconSearch } from '@tabler/icons-react';
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

/**
 * Why a voice signature, in three rows. Each row says only what the demo does: notes and
 * ratings are signed by voice. A bet is signed with a Wallet confirm, so no row is about bets.
 */
const REASONS: { icon: ReactNode; kicker: string; title: string; text: string }[] = [
  {
    icon: <IconRobotOff size={20} stroke={1.8} />,
    kicker: 'Community Notes',
    title: 'Hard for bots to fake',
    text: 'You read each note aloud. A verifier checks that the voice is yours.',
  },
  {
    icon: <IconEyeCheck size={20} stroke={1.8} />,
    kicker: 'No blind signing',
    title: 'You say what you sign',
    text: 'The wallet signs only when your words match the request. A phishing request does not match.',
  },
  {
    icon: <IconHandOff size={20} stroke={1.8} />,
    kicker: 'No confirm tap',
    title: 'Your voice is the approval',
    text: 'The wallet signs that one call. The permission ends after two minutes.',
  },
];

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
      <section className="side-box" aria-labelledby="why-voice-title">
        <h2 id="why-voice-title" className="side-title">
          Why sign by voice?
        </h2>
        <ul className="trend-list xt-why">
          {REASONS.map((reason) => (
            <li key={reason.title} className="xt-why-row">
              <span className="xt-why-icon" aria-hidden="true">
                {reason.icon}
              </span>
              <span className="xt-why-text">
                <span className="trend-kicker">{reason.kicker}</span>
                <span className="xt-why-title">{reason.title}</span>
                <span className="trend-meta muted">{reason.text}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
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
