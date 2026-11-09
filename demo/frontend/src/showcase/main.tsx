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
import { Showcase } from './Showcase';
// The notes app and its dialogs, then the page.
import '../styles.css';
import './showcase.css';

const root = document.getElementById('root');
if (!root) throw new Error('The page has no #root element.');

// One Seams Wallet for the whole page: the live apps in the windows share its sign-in.
const seamsConfig = buildSeamsConfig();

createRoot(root).render(
  <StrictMode>
    {seamsConfig ? (
      <SeamsWebProvider config={seamsConfig} theme={{ theme: 'light' }}>
        <Showcase seams />
      </SeamsWebProvider>
    ) : (
      <Showcase seams={false} />
    )}
  </StrictMode>,
);
