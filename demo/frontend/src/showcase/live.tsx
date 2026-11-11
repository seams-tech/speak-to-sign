// The live Community Notes app of the Speak-to-Sign page.

import { useMemo } from 'react';
import { useSeams } from '@seams/wallet/react';
import { App as NotesApp } from '../App';
import { config } from '../config';
import { createContractMarketSource, MarketSourceContext } from '../market/contractSource';
import { createSeamsMarketSigner } from '../market/marketSigner';
import { createMissingKeySigner, createSeamsSigner } from '../signer/seamsSigner';
import { ExampleGuard } from './guard';

/**
 * The notes app. With `seams`, it needs SeamsWebProvider above it. Without a Seams publishable
 * key, the app shows the notes and cannot sign. The app has its own guard, so an error in it
 * does not blank the page.
 */
export function LiveNotes({ seams }: { seams: boolean }) {
  return (
    <div className="ss-live-slot">
      <div className="ss-live-node">
        <ExampleGuard name="notes">{seams ? <SeamsNotes /> : <KeylessNotes />}</ExampleGuard>
      </div>
    </div>
  );
}

/** The notes app with the signer of the signed-in wallet. */
function SeamsNotes() {
  const { seams, loginState } = useSeams();
  const walletId = loginState.isLoggedIn && loginState.access === 'wallet' ? loginState.walletId : null;
  const nearAccountId = walletId ? loginState.nearAccountId : null;
  const signer = useMemo(
    () => createSeamsSigner({ seams, walletId, nearAccountId, contract: config.contract }),
    [seams, walletId, nearAccountId],
  );
  const market = useMemo(
    () => createContractMarketSource(createSeamsMarketSigner({ seams, walletId, nearAccountId, contract: config.marketContract, token: config.marketToken, rpcUrl: config.marketRpcUrl })),
    [seams, walletId, nearAccountId],
  );
  return (
    <MarketSourceContext.Provider value={market}>
      <NotesApp signer={signer} walletConfigured />
    </MarketSourceContext.Provider>
  );
}

function KeylessNotes() {
  const signer = useMemo(() => createMissingKeySigner(), []);
  return <NotesApp signer={signer} walletConfigured={false} />;
}
