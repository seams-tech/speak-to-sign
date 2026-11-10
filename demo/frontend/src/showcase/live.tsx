// The live app of a Speak-to-Sign page. The app renders once, into an element of its own,
// and that element moves between the small screen of its row and the big window. So a click
// expands the same running app: its page, its sign-in and its data stay as they are.

import { useLayoutEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSeams } from '@seams/wallet/react';
import { App as NotesApp } from '../App';
import { config } from '../config';
import { LiveMultisigScreen } from '../multisig/LiveMultisigScreen';
import { createContractMarketSource, MarketSourceContext } from '../market/contractSource';
import { createSeamsMarketSigner } from '../market/marketSigner';
import { createMissingKeySigner, createSeamsSigner } from '../signer/seamsSigner';
import { ExampleGuard } from './guard';

export type LiveId = 'notes' | 'multisig';

const nodes = new Map<LiveId, HTMLDivElement>();

function liveNode(id: LiveId): HTMLDivElement {
  let node = nodes.get(id);
  if (!node) {
    node = document.createElement('div');
    node.className = 'ss-live-node';
    nodes.set(id, node);
  }
  return node;
}

/** The place where the live app `id` shows while `active`. */
export function LiveSlot({ id, active = true }: { id: LiveId; active?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (active) ref.current?.appendChild(liveNode(id));
  }, [id, active]);
  return <div className="ss-live-slot" ref={ref} />;
}

/**
 * Renders the live app of the page (`page`) into its element. With `seams`, it needs
 * SeamsWebProvider above it. Without a Seams publishable key, the notes app shows the notes and
 * cannot sign, and there is no live multisig screen. The app has its own guard, so an error in it
 * does not blank the page.
 */
export function LiveApps({ page, seams, onMultisigSignIn }: { page: LiveId; seams: boolean; onMultisigSignIn: () => void }) {
  return (
    <>
      {page === 'notes' &&
        createPortal(<ExampleGuard name="notes">{seams ? <SeamsNotes /> : <KeylessNotes />}</ExampleGuard>, liveNode('notes'))}
      {page === 'multisig' &&
        seams &&
        createPortal(
          <ExampleGuard name="multisig">
            <LiveMultisigScreen onSignIn={onMultisigSignIn} />
          </ExampleGuard>,
          liveNode('multisig'),
        )}
    </>
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
    () => createContractMarketSource(createSeamsMarketSigner({ seams, walletId, contract: config.marketContract, token: config.marketToken })),
    [seams, walletId],
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
