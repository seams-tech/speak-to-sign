import { IconDots } from '@tabler/icons-react';
import { POSTS, type Post } from '../data/posts';
import { useDemo } from '../demoContext';
import { navigate, paths, type HomeTab } from '../router';
import { ActionRow, AuthorBadge, Avatar, Media, PostHistoryLine, PostText } from './bits';
import { notesToRate, TimelineNotes } from './NotesBox';
import { LoadState } from './LoadState';

export function Timeline({ tab }: { tab: HomeTab }) {
  const { notesByPost, account } = useDemo();
  const posts = tab === 'needs_help' ? POSTS.filter((post) => notesToRate(notesByPost[post.id] ?? [], account).length > 0) : POSTS;

  return (
    <>
      <nav className="tabs" aria-label="Timeline">
        <a href={paths.home} className={`tab ${tab === 'for_you' ? 'tab-on' : ''}`} aria-current={tab === 'for_you' ? 'page' : undefined}>
          <span>For you</span>
        </a>
        <a href={paths.needsHelp} className={`tab ${tab === 'needs_help' ? 'tab-on' : ''}`} aria-current={tab === 'needs_help' ? 'page' : undefined}>
          <span>Needs your help</span>
        </a>
      </nav>
      <LoadState />
      {posts.map((post) => (
        <TimelinePost key={post.id} post={post} showToRate={tab === 'needs_help'} />
      ))}
      {posts.length === 0 && (
        <div className="empty">
          <b>No notes need your rating</b>
          <p className="muted">When someone proposes a note, it shows here until enough people rate it.</p>
        </div>
      )}
    </>
  );
}

function TimelinePost({ post, showToRate }: { post: Post; showToRate: boolean }) {
  const { notesByPost } = useDemo();
  const open = () => navigate(paths.post(post.id));
  return (
    <article
      className="tl-post"
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target === event.currentTarget) open();
      }}
      tabIndex={0}
      aria-label={`${post.author.name}: ${post.text}`}
    >
      <Avatar author={post.author} />
      <div className="tl-main">
        <div className="tl-head">
          <b className="name">{post.author.name}</b>
          <AuthorBadge author={post.author} />
          <span className="muted handle">
            @{post.author.handle} · {post.age}
          </span>
          <IconDots size={18} className="muted tl-dots" aria-hidden="true" />
        </div>
        <div className="tl-text">
          <PostText post={post} />
        </div>
        <PostHistoryLine post={post} full={false} />
        {post.media && <Media kind={post.media} caption={post.mediaCaption} />}
        <TimelineNotes notes={notesByPost[post.id] ?? []} showToRate={showToRate} />
        <ActionRow post={post} showViews />
      </div>
    </article>
  );
}
