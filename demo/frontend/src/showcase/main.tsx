import '@fontsource/hanken-grotesk/300.css';
import '@fontsource/hanken-grotesk/400.css';
import '@fontsource/hanken-grotesk/500.css';
import '@fontsource/hanken-grotesk/600.css';
import '@fontsource/hanken-grotesk/700.css';
// The multisig example copies the multisig app's own type.
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/700.css';
import '@seams/wallet/react/styles';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SeamsWebProvider } from '@seams/wallet/react';
import { buildSeamsConfig } from '../seams/seamsConfig';
import { PAGE_PATH, type ExampleId } from './examples';
import { Showcase } from './Showcase';
// The notes app and its dialogs, then the page.
import '../styles.css';
import './showcase.css';

const root = document.getElementById('root');
if (!root) throw new Error('The page has no #root element.');

// Each HTML page names its example: index.html is Community Notes, multisig/index.html the
// voice multisig.
const page: ExampleId = document.documentElement.dataset.page === 'multisig' ? 'multisig' : 'notes';

// The multisig window was on the front page until it got its own page. Old links go there.
if (page === 'notes' && /^#\/multisig(?:\/|$)/.test(window.location.hash)) {
  window.location.replace(PAGE_PATH.multisig + window.location.hash);
} else {
  // One Seams Wallet for the page: the live app in the window shares its sign-in. Both pages are
  // on one origin, so a sign-in on one page holds on the other.
  const seamsConfig = buildSeamsConfig();

  createRoot(root).render(
    <StrictMode>
      {seamsConfig ? (
        <SeamsWebProvider config={seamsConfig} theme={{ theme: 'light' }}>
          <Showcase seams page={page} />
        </SeamsWebProvider>
      ) : (
        <Showcase seams={false} page={page} />
      )}
    </StrictMode>,
  );
}
