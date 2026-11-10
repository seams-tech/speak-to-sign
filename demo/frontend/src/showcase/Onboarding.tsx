// The setup card at the top of the Speak-to-Sign page: create a wallet or sign in, set up your
// voice, get testnet NEAR. The same steps as the notes app's Wallet bar, with the same wallet.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSeams } from '@seams/wallet/react';
import { SetupSteps } from '../components/SetupPanel';
import { config } from '../config';
import { createMissingKeySigner, createSeamsSigner } from '../signer/seamsSigner';
import type { NotesSigner, SignerSetup, SignerStatus } from '../signer/notesSigner';
import { SETUP_CHANGED } from '../signer/voiceSetup';

/** The steps with the signed-in wallet. It needs SeamsWebProvider above it. */
export function SeamsOnboarding({ onSignIn }: { onSignIn: () => void }) {
  const { seams, loginState } = useSeams();
  const walletId = loginState.isLoggedIn && loginState.access === 'wallet' ? loginState.walletId : null;
  const nearAccountId = walletId ? loginState.nearAccountId : null;
  const signer = useMemo(
    () => createSeamsSigner({ seams, walletId, nearAccountId, contract: config.contract }),
    [seams, walletId, nearAccountId],
  );
  return <Steps signer={signer} walletConfigured onSignIn={onSignIn} />;
}

/** The steps when the build has no Seams publishable key: they show, and cannot run. */
export function KeylessOnboarding() {
  const signer = useMemo(() => createMissingKeySigner(), []);
  return <Steps signer={signer} walletConfigured={false} onSignIn={() => undefined} />;
}

function Steps({ signer, walletConfigured, onSignIn }: { signer: NotesSigner & SignerSetup; walletConfigured: boolean; onSignIn: () => void }) {
  const [status, setStatus] = useState<SignerStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await signer.status());
    } catch {
      setStatus({ signedIn: false, voiceReady: false });
    }
  }, [signer]);

  useEffect(() => {
    void refresh();
    const onChange = () => void refresh();
    window.addEventListener('focus', onChange);
    window.addEventListener(SETUP_CHANGED, onChange);
    return () => {
      window.removeEventListener('focus', onChange);
      window.removeEventListener(SETUP_CHANGED, onChange);
    };
  }, [refresh]);

  const account = status?.signedIn ? status.accountId : undefined;
  return (
    <SetupSteps
      status={status}
      account={account}
      signer={signer}
      walletConfigured={walletConfigured}
      onSignIn={onSignIn}
      onChanged={() => void refresh()}
    />
  );
}
