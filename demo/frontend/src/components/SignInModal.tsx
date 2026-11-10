import { useId, useRef, useState } from 'react';
import { IconX } from '@tabler/icons-react';
import { HostedSeamsAuthMenu, type HostedAuthMenuOutcome } from '@seams/wallet/react';
import { Modal, type ModalHandle } from './Modal';

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
  const modal = useRef<ModalHandle>(null);
  const [error, setError] = useState<string | null>(null);

  const onOutcome = (outcome: HostedAuthMenuOutcome) => {
    switch (outcome.kind) {
      case 'authenticated':
      case 'registered':
      case 'account_synced':
      case 'wallet_connected':
        modal.current?.close(onSignedIn);
        return;
      case 'cancelled':
        modal.current?.close();
        return;
      case 'failed':
        setError(outcome.message || `Sign-in failed (${outcome.code}).`);
        return;
    }
  };

  // The Wallet's menu is its own card, so the dialog has no panel: the intro goes into the
  // card's subtitle, the title is for screen readers only, and Close sits on the card's corner.
  return (
    <Modal labelledBy={titleId} onClose={onClose} locked={false} bare handle={modal}>
      <h2 id={titleId} className="sr-only">
        Sign in to Seams Wallet
      </h2>
      <button type="button" className="icon-btn card-close" onClick={() => modal.current?.close()} aria-label="Close">
        <IconX size={20} />
      </button>
      <HostedSeamsAuthMenu
        onOutcome={onOutcome}
        copy={{ login: { subtitle: intro }, register: { subtitle: intro } }}
        placeholder={<div className="loading">Loading Seams Wallet</div>}
      />
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
