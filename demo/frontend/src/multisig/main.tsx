import '@fontsource/hanken-grotesk/400.css';
import '@fontsource/hanken-grotesk/500.css';
import '@fontsource/hanken-grotesk/600.css';
import '@fontsource/hanken-grotesk/700.css';
import '@seams/wallet/react/styles';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { buildSeamsConfig } from '../seams/seamsConfig';
import { ThemedSeamsProvider } from '../seams/walletTheme';
import { MultisigPage } from './MultisigPage';
// The setup steps and the sign-in dialog use the notes app's styles.
import '../styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('The page has no #root element.');

// The same Seams project and wallet as the Community Notes page at /: both pages are on one origin.
const seamsConfig = buildSeamsConfig();

createRoot(root).render(
  <StrictMode>
    {seamsConfig ? (
      <ThemedSeamsProvider config={seamsConfig} theme="light">
        <MultisigPage seams />
      </ThemedSeamsProvider>
    ) : (
      <MultisigPage seams={false} />
    )}
  </StrictMode>,
);
