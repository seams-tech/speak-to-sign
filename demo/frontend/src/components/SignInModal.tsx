import { useId, useState } from 'react';
import { IconX } from '@tabler/icons-react';
import { HostedSeamsAuthMenu, type HostedAuthMenuOutcome } from '@seams/wallet/react';
import { Modal } from './Modal';

const NOTES_INTRO =
  'Your notes and ratings are signed from your own NEAR testnet account. Use a passkey to sign in, or create a new wallet.';

/** Seams Wallet sign-in and registration. The menu runs inside the Wallet's own iframe. */
export function SignInModal({
  onClose,
  onSignedIn,
  intro = NOTES_INTRO,
}: {
  onClose: () => void;
  onSignedIn: () => void;
  /** What the page signs, in one or two sentences. */
  intro?: string;
}) {
  const titleId = useId();
  const [error, setError] = useState<string | null>(null);

  const onOutcome = (outcome: HostedAuthMenuOutcome) => {
    switch (outcome.kind) {
      case 'authenticated':
      case 'registered':
      case 'account_synced':
      case 'wallet_connected':
        onSignedIn();
        return;
      case 'cancelled':
        onClose();
        return;
      case 'failed':
        setError(outcome.message || `Sign-in failed (${outcome.code}).`);
        return;
    }
  };

  return (
    <Modal labelledBy={titleId} onClose={onClose} locked={false}>
      <header className="dialog-head">
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          <IconX size={20} />
        </button>
        <h2 id={titleId}>Sign in to Seams Wallet</h2>
      </header>
      <div className="dialog-body">
        <p className="muted small field-help">{intro}</p>
        <div className="auth-menu">
          <HostedSeamsAuthMenu onOutcome={onOutcome} placeholder={<div className="loading">Loading Seams Wallet</div>} />
        </div>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
