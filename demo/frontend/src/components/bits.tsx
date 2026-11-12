import type { ReactNode } from 'react';
import {
  IconBookmark,
  IconChartBar,
  IconExternalLink,
  IconHeart,
  IconMessageCircle,
  IconMicrophone,
  IconRepeat,
  IconRosetteDiscountCheckFilled,
  IconUpload,
} from '@tabler/icons-react';
import { shortAccount, shortHash, transactionUrl } from '../config';
import type { Post, PostAuthor } from '../data/posts';

export function Avatar({ author, size = 40 }: { author: PostAuthor; size?: number }) {
  const square = author.kind === 'organization';
  if (author.avatarUrl) {
    return (
      <img
        className={`avatar ${square ? 'avatar-square' : 'avatar-round'}`}
        style={{ width: size, height: size, objectFit: 'cover' }}
        src={author.avatarUrl}
        alt=""
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <div
      className={`avatar ${square ? 'avatar-square' : 'avatar-round'}`}
      style={{ width: size, height: size, backgroundColor: author.color, fontSize: author.initials.length > 3 ? 10 : 15 }}
      aria-hidden="true"
    >
      {author.initials}
    </div>
  );
}

const BADGE_LABELS = {
  gold: 'Verified organization',
  gray: 'Government account',
  blue: 'Paid verification',
} as const;

export function AuthorBadge({ author }: { author: PostAuthor }) {
  if (!author.badge) return null;
  return <IconRosetteDiscountCheckFilled className={`badge badge-${author.badge}`} size={18} aria-label={BADGE_LABELS[author.badge]} />;
}

const LINK = /((?:https?:\/\/)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s]*)?)/gi;

/** Shows web addresses in the text as links. */
export function Linkified({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    const start = match.index ?? 0;
    const trailing = /[.,;:!?)]+$/.exec(match[0])?.[0] ?? '';
    const shown = match[0].slice(0, match[0].length - trailing.length);
    if (start > last) parts.push(text.slice(last, start));
    const href = /^https?:\/\//i.test(shown) ? shown : `https://${shown}`;
    parts.push(
      <a key={start} className="lk" href={href} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>
        {shown.replace(/^https?:\/\//i, '')}
      </a>,
    );
    last = start + shown.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

export function PostText({ post }: { post: Post }) {
  return (
    <>
      {post.linkify ? <Linkified text={post.text} /> : post.text}
      {post.link && (
        <>
          {' '}
          <Linkified text={post.link} />
        </>
      )}
    </>
  );
}

/** The reply, repost, like, views or bookmark, and share buttons. They copy the look only. */
export function ActionRow({ post, showViews }: { post: Post; showViews: boolean }) {
  return (
    <div className={`actions ${showViews ? '' : 'actions-wide'}`} aria-hidden="true">
      <Action tone="blue" icon={<IconMessageCircle size={19} stroke={1.6} />} count={post.stats?.replies} />
      <Action tone="green" icon={<IconRepeat size={19} stroke={1.6} />} count={post.stats?.reposts} />
      <Action tone="pink" icon={<IconHeart size={19} stroke={1.6} />} count={post.stats?.likes} />
      {showViews ? (
        <>
          <Action tone="blue" icon={<IconChartBar size={19} stroke={1.6} />} count={post.stats?.views} />
          <span className="act-end">
            <Action tone="blue" icon={<IconBookmark size={19} stroke={1.6} />} />
            <Action tone="blue" icon={<IconUpload size={19} stroke={1.6} />} />
          </span>
        </>
      ) : (
        <>
          <Action tone="blue" icon={<IconBookmark size={19} stroke={1.6} />} count={post.stats?.bookmarks} />
          <Action tone="blue" icon={<IconUpload size={19} stroke={1.6} />} />
        </>
      )}
    </div>
  );
}

function Action({ tone, icon, count }: { tone: 'blue' | 'green' | 'pink'; icon: ReactNode; count?: string }) {
  return (
    <span className={`act act-${tone}`}>
      <span className="act-icon">{icon}</span>
      {count && <span className="act-count">{count}</span>}
    </span>
  );
}

/** "Voice-signed by alice.testnet" with the transaction link when this session knows it. */
export function VoiceSigned({ account, hash, extra }: { account: string; hash?: string; extra?: ReactNode }) {
  return (
    <span className="voice-signed">
      <IconMicrophone size={14} stroke={1.8} aria-hidden="true" />
      <span>
        Voice-signed by <b title={account}>{shortAccount(account)}</b>
        {extra}
        {hash && (
          <>
            {' · '}
            <TxLink hash={hash} />
          </>
        )}
      </span>
    </span>
  );
}

export function TxLink({ hash }: { hash: string }) {
  return (
    <a
      className="lk tx-link"
      href={transactionUrl(hash)}
      target="_blank"
      rel="noopener noreferrer"
      title={`Transaction ${hash}`}
      onClick={(event) => event.stopPropagation()}
    >
      Tx {shortHash(hash)}
      <IconExternalLink size={13} stroke={1.8} aria-hidden="true" />
    </a>
  );
}
