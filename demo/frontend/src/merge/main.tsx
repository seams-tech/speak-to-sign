import '@seams/wallet/react/styles';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SeamsWebProvider, useSeams } from '@seams/wallet/react';
import { buildSeamsConfig } from '../seams/seamsConfig';
import { MergeApp } from './MergeApp';
// The dialog styles (the sign-in modal) come from the notes page.
import '../styles.css';
import './merge.css';

/** The merge page with the signed-in wallet, if any. */
function SeamsMergeApp() {
  const { seams, loginState } = useSeams();
  const walletId = loginState.isLoggedIn && loginState.access === 'wallet' ? loginState.walletId : null;
  const nearAccountId = walletId ? loginState.nearAccountId : null;
  return <MergeApp seams={seams} walletId={walletId} nearAccountId={nearAccountId} />;
}

const root = document.getElementById('root');
if (!root) throw new Error('The page has no #root element.');

const seamsConfig = buildSeamsConfig();

createRoot(root).render(
  <StrictMode>
    {seamsConfig ? (
      <SeamsWebProvider config={seamsConfig} theme={{ theme: 'light' }}>
        <SeamsMergeApp />
      </SeamsWebProvider>
    ) : (
      <MergeApp seams={null} walletId={null} nearAccountId={null} />
    )}
  </StrictMode>,
);
