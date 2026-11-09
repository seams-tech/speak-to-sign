import { useEffect, useRef, type ReactNode } from 'react';
import { IconChevronRight, IconSearch } from '@tabler/icons-react';
import { POSTS } from '../data/posts';
import { useDemo } from '../demoContext';
import { paths } from '../router';
import { notesToRate, shownNote } from './NotesBox';

/**
 * The side column. It scrolls with the page until its bottom reaches the bottom of the
 * window, then it stays there, as on the original site.
 */
export function StickySide({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const side = ref.current;
    if (!side) return;
    const update = () => {
      side.style.top = `${Math.min(0, window.innerHeight - side.offsetHeight)}px`;
    };
    const observer = new ResizeObserver(update);
    observer.observe(side);
    window.addEventListener('resize', update);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);
  return (
    <aside className="side" ref={ref}>
      {children}
    </aside>
  );
}

/** The search pill at the top of the side column. It copies the look only. */
export function SideSearch() {
  return (
    <div className="side-search" aria-hidden="true">
      <IconSearch size={18} stroke={1.8} />
      <span>Search</span>
    </div>
  );
}

/** One row for each post that has notes, like the trends box on the original site. */
export function NotesActivity() {
  const { notesByPost, account, loading } = useDemo();
  const rows = POSTS.flatMap((post) => {
    const notes = notesByPost[post.id] ?? [];
    if (notes.length === 0) return [];
    const shown = shownNote(notes);
    const toRate = notesToRate(notes, account);
    const mine = notes.filter((note) => note.author === account);
    const kicker = shown ? 'Note shown · rated helpful' : toRate.length > 0 ? 'Needs your help' : 'Your note';
    const meta =
      toRate.length > 0
        ? `${toRate.length} ${toRate.length === 1 ? 'note needs' : 'notes need'} ratings`
        : shown
          ? `${shown.helpful} helpful ${shown.helpful === 1 ? 'rating' : 'ratings'}`
          : mine.length > 0
            ? 'Waiting for ratings from others'
            : `${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`;
    return [{ post, kicker, meta, needsHelp: toRate.length > 0 }];
  });

  return (
    <section className="side-box" aria-labelledby="activity-title">
      <h2 id="activity-title" className="side-title">
        Notes activity
      </h2>
      {rows.length === 0 ? (
        <p className="side-empty muted">
          {loading ? 'Reading notes from testnet…' : 'No notes yet. Open a post and write the first one with your voice.'}
        </p>
      ) : (
        <ul className="trend-list">
          {rows.map(({ post, kicker, meta, needsHelp }) => (
            <li key={post.id}>
              <a className="trend" href={paths.post(post.id)}>
                <span className={`trend-kicker ${needsHelp ? 'trend-kicker-help' : ''}`}>
                  {post.author.name} · {kicker}
                </span>
                <span className="trend-title">{post.text}</span>
                <span className="trend-meta muted">{meta}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <a className="side-more" href={paths.needsHelp}>
        Rate proposed notes
        <IconChevronRight size={16} stroke={2} aria-hidden="true" />
      </a>
    </section>
  );
}
