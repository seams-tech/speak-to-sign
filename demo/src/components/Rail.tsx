import {
  IconBell,
  IconBookmark,
  IconChecklist,
  IconDots,
  IconDotsCircleHorizontal,
  IconFeather,
  IconHome,
  IconHomeFilled,
  IconMail,
  IconSearch,
  IconUser,
} from '@tabler/icons-react';
import { shortAccount } from '../config';
import { useDemo } from '../demoContext';
import { paths, type Route } from '../router';

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
 * Only Home and the main button work; the other items copy the look.
 */
export function Rail({ route }: { route: Route }) {
  const { account, status, openWrite, openSignIn } = useDemo();
  const onHome = route.name === 'home';
  const Home = onHome ? IconHomeFilled : IconHome;

  return (
    <header className="rail">
      <nav className="rail-inner" aria-label="Main">
        <a className="rail-logo" href={paths.home} aria-label="Spoken Notes, home">
          <BrandMark />
        </a>
        <a className="rail-item rail-link" href={paths.home} aria-current={onHome ? 'page' : undefined}>
          <span className="rail-item-pill">
            <Home size={26} stroke={1.8} aria-hidden="true" />
            <span className={`rail-label ${onHome ? 'rail-label-on' : ''}`}>Home</span>
          </span>
        </a>
        {DECOR.map(({ label, Icon }) => (
          <span key={label} className="rail-item" aria-hidden="true">
            <span className="rail-item-pill">
              <Icon size={26} stroke={1.6} />
              <span className="rail-label">{label}</span>
            </span>
          </span>
        ))}
        {route.name === 'post' ? (
          <button type="button" className="rail-cta" onClick={() => openWrite(route.postId)}>
            <IconFeather className="rail-cta-icon" size={22} stroke={1.8} aria-hidden="true" />
            <span className="rail-cta-label">Write a note</span>
          </button>
        ) : (
          <a className="rail-cta" href={paths.needsHelp}>
            <IconChecklist className="rail-cta-icon" size={22} stroke={1.8} aria-hidden="true" />
            <span className="rail-cta-label">Rate notes</span>
          </a>
        )}
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

/** Spoken Notes: a speech bubble with sound bars. */
export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path
        d="M16 3C8.8 3 3 8.3 3 14.8c0 3.6 1.8 6.8 4.6 9L6.4 29l5.6-2.9c1.3.4 2.6.5 4 .5 7.2 0 13-5.3 13-11.8S23.2 3 16 3Z"
        fill="currentColor"
      />
      <g stroke="#fff" strokeWidth="2.4" strokeLinecap="round">
        <path d="M10.5 13v3.6" />
        <path d="M14.2 10.4v8.8" />
        <path d="M17.9 12v5.6" />
        <path d="M21.6 13.6v2.4" />
      </g>
    </svg>
  );
}
