import {
  IconBell,
  IconBookmark,
  IconChecklist,
  IconDotsCircleHorizontal,
  IconHome,
  IconMail,
  IconSearch,
  IconUser,
} from '@tabler/icons-react';
import { useDemo } from '../demoContext';
import { paths } from '../router';

const DECOR = [
  { label: 'Home', Icon: IconHome },
  { label: 'Explore', Icon: IconSearch },
  { label: 'Notifications', Icon: IconBell },
  { label: 'Messages', Icon: IconMail },
  { label: 'Bookmarks', Icon: IconBookmark },
  { label: 'Profile', Icon: IconUser },
  { label: 'More', Icon: IconDotsCircleHorizontal },
];

/**
 * The left navigation. Wide screens show the labels; narrow screens show icons only.
 * The menu items copy the look only, in a dim grey that does not invite a click. There is no
 * account block. The timeline has the attention.
 */
export function Rail() {
  return (
    // For the look only, as on X. Screen readers and the keyboard pass over it.
    <div className="rail" aria-hidden="true">
      <div className="rail-inner">
        {DECOR.map(({ label, Icon }) => (
          <span key={label} className="rail-item">
            <span className="rail-item-pill">
              <Icon size={24} stroke={1.6} />
              <span className="rail-label">{label}</span>
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * The tab bar at the bottom of a phone screen, where the left navigation is hidden.
 * The account works; the other places copy the look. There is no round write button: the post
 * page's own "Write a note" row is the one way to write, and a floating button covered it.
 */
export function BottomBar() {
  const { account, openSignIn } = useDemo();

  return (
    <>
      <nav className="bottom-bar" aria-label="Main">
        <a className="bottom-item" href={paths.timeline} aria-label="Home">
          <IconHome size={26} stroke={1.8} aria-hidden="true" />
        </a>
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
