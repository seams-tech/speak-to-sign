import '@seams/wallet/react/styles';
import { StrictMode, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { SeamsWebProvider, useSeams } from '@seams/wallet/react';
import { App } from './App';
import { config } from './config';
import { buildSeamsConfig } from './seams/seamsConfig';
import { createMissingKeySigner, createSeamsSigner } from './signer/seamsSigner';
import './styles.css';

/** The app with the Seams Wallet signer of the signed-in wallet. */
function SeamsApp() {
  const { seams, loginState } = useSeams();
  const walletId = loginState.isLoggedIn && loginState.access === 'wallet' ? loginState.walletId : null;
  const nearAccountId = walletId ? loginState.nearAccountId : null;
  const signer = useMemo(
    () => createSeamsSigner({ seams, walletId, nearAccountId, contract: config.contract }),
    [seams, walletId, nearAccountId],
  );
  return <App signer={signer} walletConfigured />;
}

const root = document.getElementById('root');
if (!root) throw new Error('The page has no #root element.');

const seamsConfig = buildSeamsConfig();

createRoot(root).render(
  <StrictMode>
    {seamsConfig ? (
      <SeamsWebProvider config={seamsConfig} theme={{ theme: 'light' }}>
        <SeamsApp />
      </SeamsWebProvider>
    ) : (
      <App signer={createMissingKeySigner()} walletConfigured={false} />
    )}
  </StrictMode>,
);
