import '@seams/wallet/react/styles';
import './styles.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { SeamsWebProvider, Theme } from '@seams/wallet/react';
import { readSettings, type Settings } from './config';
import { SpeakToPayFlow } from './SpeakToPayFlow';

function SpeakToPayPage({ settings }: { settings: Settings }): React.JSX.Element {
  return (
    <Theme theme="light" tag="div" className="stp-theme">
      <main className="stp-page">
        <header className="stp-intro">
          <p className="stp-eyebrow">NEAR testnet only</p>
          <h1>Speak to pay</h1>
          <p>
            Pay any named NEAR account with your voice. An attested verifier checks your voice and
            your words, and your Wallet then pays from your own account with no confirm. Do not
            use real funds.
          </p>
        </header>
        {settings.kind === 'ready' ? (
          <SeamsWebProvider theme={{ theme: 'light' }} config={settings.seamsConfig}>
            <div className="stp-flow">
              <SpeakToPayFlow rpcUrl={settings.nearRpcUrl} />
            </div>
          </SeamsWebProvider>
        ) : (
          <div className="stp-notice" data-tone="error" role="alert">
            Set {settings.names.join(', ')} in <code>.env.local</code>, then restart{' '}
            <code>pnpm dev</code>. The README says where to get the value.
          </div>
        )}
      </main>
    </Theme>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Speak to pay requires a root element.');
createRoot(root).render(
  <React.StrictMode>
    <SpeakToPayPage settings={readSettings()} />
  </React.StrictMode>,
);
