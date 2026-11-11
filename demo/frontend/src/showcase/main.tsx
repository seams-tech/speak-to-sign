import '@fontsource/hanken-grotesk/300.css';
import '@fontsource/hanken-grotesk/400.css';
import '@fontsource/hanken-grotesk/500.css';
import '@fontsource/hanken-grotesk/600.css';
import '@fontsource/hanken-grotesk/700.css';
import '@seams/wallet/react/styles';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { SeamsConfigsInput } from '@seams/wallet';
import { buildSeamsConfig } from '../seams/seamsConfig';
import { ThemedSeamsProvider } from '../seams/walletTheme';
import { NotesPage } from './NotesPage';
import { useTheme } from './theme';
// The notes app and its dialogs, then the page.
import '../styles.css';
import './showcase.css';

const root = document.getElementById('root');
if (!root) throw new Error('The page has no #root element.');

const seamsConfig = buildSeamsConfig();

/** The Wallet follows the theme of the page (Lights out on dark). */
function WithWallet({ config }: { config: SeamsConfigsInput }) {
  const pageTheme = useTheme();
  return (
    <ThemedSeamsProvider config={config} theme={pageTheme}>
      <NotesPage seams />
    </ThemedSeamsProvider>
  );
}

createRoot(root).render(
  <StrictMode>{seamsConfig ? <WithWallet config={seamsConfig} /> : <NotesPage seams={false} />}</StrictMode>,
);
