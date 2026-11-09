// The live apps of the Speak-to-Sign page. Each app renders once, into an element of its own,
// and that element moves between the small screen of its row and the big window. So a click
// expands the same running app: its page, its sign-in and its data stay as they are.

import { useLayoutEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSeams } from '@seams/wallet/react';
import { App as NotesApp } from '../App';
import { config } from '../config';
import { LiveMergeScreen } from '../merge/LiveMergeScreen';
import { createMissingKeySigner, createSeamsSigner } from '../signer/seamsSigner';

export type LiveId = 'notes' | 'merge';

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
 * Renders the live apps into their elements. With `seams`, it needs SeamsWebProvider above it.
 * Without a Seams publishable key, the notes app shows the notes and cannot sign, and there is
 * no live merge screen.
 */
export function LiveApps({ seams, mergeSay, onMergeSignIn }: { seams: boolean; mergeSay: string; onMergeSignIn: () => void }) {
  return (
    <>
      {createPortal(seams ? <SeamsNotes /> : <KeylessNotes />, liveNode('notes'))}
      {seams && createPortal(<LiveMergeScreen say={mergeSay} onSignIn={onMergeSignIn} />, liveNode('merge'))}
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
  return <NotesApp signer={signer} walletConfigured />;
}

function KeylessNotes() {
  const signer = useMemo(() => createMissingKeySigner(), []);
  return <NotesApp signer={signer} walletConfigured={false} />;
}
