import { IconArrowLeft, IconDots, IconUsers } from '@tabler/icons-react';
import { findPost } from '../data/posts';
import { useDemo } from '../demoContext';
import { navigate, paths } from '../router';
import { ActionRow, AuthorBadge, Avatar, Media, PostText } from './bits';
import { LoadState } from './LoadState';
import { PostNotes } from './NotesBox';

export function PostDetail({ postId }: { postId: number }) {
  const { notesByPost, openWrite } = useDemo();
  const post = findPost(postId);

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
          {post.media && <Media kind={post.media} height={180} />}
          <LoadState />
          <PostNotes notes={notesByPost[post.id] ?? []} />
          <div className="pd-time muted">
            {post.postedAt} · <b className="ink">{post.stats.views}</b> Views
          </div>
          <ActionRow post={post} showViews={false} />
          <div className="write-row">
            <IconUsers size={20} stroke={1.8} className="muted" aria-hidden="true" />
            <div className="write-row-text">
              <b>Does this post need context?</b>
              <div className="muted small">Write a Community Note and post it with your voice.</div>
            </div>
            <button type="button" className="btn btn-dark btn-sm" onClick={() => openWrite(post.id)}>
              Write a note
            </button>
          </div>
        </article>
      )}
    </>
  );
}
