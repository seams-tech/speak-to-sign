import type { ReactNode } from 'react';
import {
  IconBookmark,
  IconBuildingBridge,
  IconChartBar,
  IconExternalLink,
  IconHeart,
  IconMessageCircle,
  IconMicrophone,
  IconPaw,
  IconRepeat,
  IconRosetteDiscountCheckFilled,
  IconTemperature,
  IconUpload,
} from '@tabler/icons-react';
import { config, shortHash, transactionUrl } from '../config';
import type { MediaKind, Post, PostAuthor } from '../data/posts';

export function Avatar({ author, size = 40 }: { author: PostAuthor; size?: number }) {
  const square = author.kind === 'organization';
  return (
    <div
      className={`avatar ${square ? 'avatar-square' : ''}`}
      style={{ width: size, height: size, background: author.color, fontSize: author.initials.length > 3 ? 10 : 13 }}
      aria-hidden="true"
    >
      {author.initials}
    </div>
  );
}

export function AuthorBadge({ author }: { author: PostAuthor }) {
  if (author.kind !== 'organization') return null;
  return <IconRosetteDiscountCheckFilled className="badge-gold" size={18} aria-label="Verified organization" />;
}

const MEDIA_ICONS: Record<MediaKind, typeof IconPaw> = {
  bridge: IconBuildingBridge,
  heat: IconTemperature,
  panda: IconPaw,
};

export function Media({ kind, height }: { kind: MediaKind; height: number }) {
  const Icon = MEDIA_ICONS[kind];
  return (
    <div className="media" style={{ height }} aria-hidden="true">
      <Icon size={56} stroke={1.5} />
    </div>
  );
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
      {post.text}
      {post.link && (
        <>
          {' '}
          <Linkified text={post.link} />
        </>
      )}
    </>
  );
}

export function ActionRow({ post, showViews }: { post: Post; showViews: boolean }) {
  return (
    <div className={`actions ${showViews ? '' : 'actions-wide'}`} aria-hidden="true">
      <span>
        <IconMessageCircle size={19} stroke={1.6} /> {post.stats.replies}
      </span>
      <span>
        <IconRepeat size={19} stroke={1.6} /> {post.stats.reposts}
      </span>
      <span>
        <IconHeart size={19} stroke={1.6} /> {post.stats.likes}
      </span>
      {showViews ? (
        <span>
          <IconChartBar size={19} stroke={1.6} /> {post.stats.views}
        </span>
      ) : (
        <span>
          <IconBookmark size={19} stroke={1.6} /> {post.stats.bookmarks}
        </span>
      )}
      <span>
        <IconUpload size={19} stroke={1.6} />
      </span>
    </div>
  );
}

/** "Voice-signed by alice.testnet" with the transaction link when this session knows it. */
export function VoiceSigned({ account, hash, extra }: { account: string; hash?: string; extra?: ReactNode }) {
  return (
    <span className="voice-signed">
      <IconMicrophone size={14} stroke={1.8} aria-hidden="true" />
      <span>
        Voice-signed by <b>{account}</b>
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
      title={config.mock ? 'Mock hash: there is no real transaction' : `Transaction ${hash}`}
      onClick={(event) => event.stopPropagation()}
    >
      Tx {shortHash(hash)}
      <IconExternalLink size={13} stroke={1.8} aria-hidden="true" />
    </a>
  );
}
