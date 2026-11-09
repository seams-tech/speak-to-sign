import {
  IconBell,
  IconBookmark,
  IconCircleDashed,
  IconDotsCircleHorizontal,
  IconFeather,
  IconHome,
  IconHomeFilled,
  IconMail,
  IconSearch,
  IconUser,
} from '@tabler/icons-react';
import { useDemo } from '../demoContext';
import { paths } from '../router';

/** The left icon rail. Only Home works; the other icons copy the look. */
export function Rail({ onHome }: { onHome: boolean }) {
  const { account } = useDemo();
  const Home = onHome ? IconHomeFilled : IconHome;
  return (
    <nav className="rail" aria-label="Main">
      <span className="rail-icon" title="Logo slot" aria-hidden="true">
        <IconCircleDashed size={28} stroke={1.6} />
      </span>
      <a className="rail-icon rail-link" href={paths.home} aria-label="Home" aria-current={onHome ? 'page' : undefined}>
        <Home size={27} stroke={1.8} />
      </a>
      {[IconSearch, IconBell, IconMail, IconBookmark, IconUser, IconDotsCircleHorizontal].map((Icon, index) => (
        <span key={index} className="rail-icon" aria-hidden="true">
          <Icon size={27} stroke={1.6} />
        </span>
      ))}
      <span className="rail-post" aria-hidden="true">
        <IconFeather size={22} stroke={1.8} />
      </span>
      <span className="rail-fill" />
      <span className="rail-me" title={account ?? 'Not signed in'} aria-label={account ? `Signed in as ${account}` : 'Not signed in'}>
        {account ? account.charAt(0).toUpperCase() : ''}
      </span>
    </nav>
  );
}
