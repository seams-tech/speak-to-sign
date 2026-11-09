import { IconArrowLeft, IconDots, IconHandFingerRight, IconUsers } from '@tabler/icons-react';
import { findPost } from '../data/posts';
import { useDemo, useWriteCue } from '../demoContext';
import { navigate, paths } from '../router';
import { ActionRow, AuthorBadge, Avatar, Media, PostHistoryLine, PostText } from './bits';
import { LoadState } from './LoadState';
import { PostNotes } from './NotesBox';
import { PostContextBox } from './PostContext';

export function PostDetail({ postId }: { postId: number }) {
  const { notesByPost, openWrite } = useDemo();
  const post = findPost(postId);
  const notes = notesByPost[postId] ?? [];
  // Until the visitor has a note on this post, the write row is the next step: it is
  // highlighted, and a hand points at its button.
  const cue = useWriteCue(postId);

  const back = () => navigate(paths.home);

  return (
    <>
      <header className="page-head">
        <button type="button" className="icon-btn" onClick={back} aria-label="Back">
          <IconArrowLeft size={20} />
        </button>
        <h1>Post</h1>
      </header>
      {!post ? (
        <div className="empty">
          <b>This post does not exist</b>
          <p>
            <a className="lk" href={paths.home}>
              Go to the timeline
            </a>
          </p>
        </div>
      ) : (
        <article className="pd">
          <div className="pd-head">
            <Avatar author={post.author} />
            <div className="pd-who">
              <div>
                <b className="name">{post.author.name}</b> <AuthorBadge author={post.author} />
              </div>
              <div className="muted">@{post.author.handle}</div>
            </div>
            <IconDots size={18} className="muted" aria-hidden="true" />
          </div>
          <div className="pd-text">
            <PostText post={post} />
          </div>
          {post.media && <Media kind={post.media} caption={post.mediaCaption} compact />}
          {post.context ? <PostContextBox post={post} /> : <PostHistoryLine post={post} full />}
          <LoadState />
          <PostNotes notes={notes} />
          {/* Before the time and the actions, so the button shows without a scroll. */}
          <div className={`write-row ${cue ? 'write-row-cue' : ''}`}>
            <IconUsers size={20} stroke={1.8} className={cue ? 'cue-icon' : 'muted'} aria-hidden="true" />
            <div className="write-row-text">
              <b>Does this post need context?</b>
              <div className="muted small">Write a Community Note and post it with your voice.</div>
            </div>
            {cue && <IconHandFingerRight size={28} stroke={1.7} className="cue-hand" aria-hidden="true" />}
            <button type="button" className={`btn ${cue ? 'btn-cue' : 'btn-blue'}`} onClick={() => openWrite(post.id)}>
              Write a note
            </button>
          </div>
          <div className="pd-time muted">
            {post.postedAt}
            {post.stats && (
              <>
                {' '}
                · <b className="ink">{post.stats.views}</b> Views
              </>
            )}
          </div>
          <ActionRow post={post} showViews={false} />
        </article>
      )}
    </>
  );
}
