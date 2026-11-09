import {
  IconBell,
  IconBookmark,
  IconChecklist,
  IconDots,
  IconDotsCircleHorizontal,
  IconFeather,
  IconHome,
  IconMail,
  IconSearch,
  IconUser,
} from '@tabler/icons-react';
import { shortAccount } from '../config';
import { useDemo, useWriteCue } from '../demoContext';
import type { Route } from '../router';

const DECOR = [
  { label: 'Explore', Icon: IconSearch },
  { label: 'Notifications', Icon: IconBell },
  { label: 'Messages', Icon: IconMail },
  { label: 'Bookmarks', Icon: IconBookmark },
  { label: 'Profile', Icon: IconUser },
  { label: 'More', Icon: IconDotsCircleHorizontal },
];

/**
 * The left navigation. Wide screens show the labels; narrow screens show icons only.
 * The demo has one page, the post, so the menu items copy the look only, in a dim grey that does
 * not invite a click. The account works.
 */
export function Rail() {
  const { account, status, openSignIn } = useDemo();

  return (
    <header className="rail">
      <nav className="rail-inner" aria-label="Main">
        <span className="rail-item" aria-hidden="true">
          <span className="rail-item-pill">
            <IconHome size={24} stroke={1.8} />
            <span className="rail-label">Home</span>
          </span>
        </span>
        {DECOR.map(({ label, Icon }) => (
          <span key={label} className="rail-item" aria-hidden="true">
            <span className="rail-item-pill">
              <Icon size={24} stroke={1.6} />
              <span className="rail-label">{label}</span>
            </span>
          </span>
        ))}
      </nav>

      {account ? (
        <div className="rail-me" title={account}>
          <span className="rail-me-avatar" aria-hidden="true">
            {account.charAt(0).toUpperCase()}
          </span>
          <span className="rail-me-text">
            <b className="rail-me-name">{shortAccount(account)}</b>
            <span className="muted rail-me-sub">{status?.voiceReady ? 'VoiceID on' : 'VoiceID off'}</span>
          </span>
          <IconDots className="rail-me-dots" size={18} aria-hidden="true" />
        </div>
      ) : (
        <button type="button" className="rail-me rail-me-btn" onClick={openSignIn}>
          <span className="rail-me-avatar rail-me-avatar-empty" aria-hidden="true">
            <IconUser size={20} stroke={1.8} />
          </span>
          <span className="rail-me-text">
            <b className="rail-me-name">Sign in</b>
            <span className="muted rail-me-sub">to Seams Wallet</span>
          </span>
        </button>
      )}
    </header>
  );
}

/**
 * The tab bar at the bottom of a phone screen, where the left navigation is hidden.
 * The account works; the other places copy the look.
 * On a post page, a round button writes a note.
 */
export function BottomBar({ route }: { route: Route }) {
  const { account, openWrite, openSignIn } = useDemo();
  const cue = useWriteCue(route.name === 'post' ? route.postId : null);

  return (
    <>
      {route.name === 'post' && (
        <button type="button" className={`fab ${cue ? 'fab-cue' : ''}`} aria-label="Write a note" onClick={() => openWrite(route.postId)}>
          <IconFeather size={24} stroke={1.8} aria-hidden="true" />
        </button>
      )}
      <nav className="bottom-bar" aria-label="Main">
        <span className="bottom-item" aria-hidden="true">
          <IconHome size={26} stroke={1.8} />
        </span>
        <span className="bottom-item" aria-hidden="true">
          <IconSearch size={26} stroke={1.6} />
        </span>
        <span className="bottom-item" aria-hidden="true">
          <IconChecklist size={26} stroke={1.6} />
        </span>
        <span className="bottom-item" aria-hidden="true">
          <IconBell size={26} stroke={1.6} />
        </span>
        <span className="bottom-item" aria-hidden="true">
          <IconMail size={26} stroke={1.6} />
        </span>
        {account ? (
          <span className="bottom-item" title={account} aria-label={`Signed in as ${account}`}>
            <span className="bottom-avatar" aria-hidden="true">
              {account.charAt(0).toUpperCase()}
            </span>
          </span>
        ) : (
          <button type="button" className="bottom-item bottom-btn" aria-label="Sign in to Seams Wallet" onClick={openSignIn}>
            <IconUser size={26} stroke={1.6} aria-hidden="true" />
          </button>
        )}
      </nav>
    </>
  );
}
