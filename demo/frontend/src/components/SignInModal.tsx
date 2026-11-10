import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconX } from '@tabler/icons-react';
import { HostedSeamsAuthMenu, type HostedAuthMenuOutcome } from '@seams/wallet/react';
import { Modal, type ModalHandle } from './Modal';

const NOTES_INTRO =
  'Your notes and ratings are signed from your own NEAR testnet account. Use a passkey to sign in, or create a new wallet.';

/**
 * Seams Wallet sign-in and registration. The menu runs inside the Wallet's own iframe, which the
 * SDK places over this element and keeps there while the element moves.
 */
function SignInMenu({ intro, onSignedIn, onCancel }: { intro: string; onSignedIn: () => void; onCancel: () => void }) {
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
        onCancel();
        return;
      case 'failed':
        setError(outcome.message || `Sign-in failed (${outcome.code}).`);
        return;
    }
  };

  return (
    <>
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
    </>
  );
}

/** The sign-in on its own, for a place with no open dialog (the page, the notes app's bar). */
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
      <SignInMenu intro={intro} onSignedIn={() => modal.current?.close(onSignedIn)} onCancel={() => modal.current?.close()} />
    </Modal>
  );
}

/**
 * The sign-in as a step of an open dialog, in place of a second dialog on top. The dialog
 * shrinks to the Wallet's card and drops its own panel, so the card is the dialog. Close (on the
 * card's corner), Escape and a click outside return to the step before.
 */
export function SignInStep({
  titleId,
  intro = NOTES_INTRO,
  onSignedIn,
  onBack,
}: {
  /** The id that labels the dialog. */
  titleId: string;
  intro?: string;
  onSignedIn: () => void;
  onBack: () => void;
}) {
  return (
    <>
      <h2 id={titleId} className="sr-only">
        Sign in to Seams Wallet
      </h2>
      <div className="signin-step">
        <SignInMenu intro={intro} onSignedIn={onSignedIn} onCancel={onBack} />
        <CardCorner onClick={onBack} />
      </div>
    </>
  );
}

/** How long the corner button follows the dialog closely: its open and resize animations. */
const FOLLOW_MS = 900;

/**
 * Close, on the top right corner of the dialog. The Wallet's card is an iframe above the page's
 * dialogs, so the button sits in its own layer above the card and follows the dialog's place.
 */
function CardCorner({ onClick }: { onClick: () => void }) {
  const marker = useRef<HTMLSpanElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    const panel = marker.current?.closest('.dialog');
    if (!panel) return;
    const update = () => {
      const rect = panel.getBoundingClientRect();
      setPlace({ top: rect.top + 10, left: rect.right - 46 });
    };
    const until = performance.now() + FOLLOW_MS;
    let frame = requestAnimationFrame(function follow(now) {
      update();
      if (now < until) frame = requestAnimationFrame(follow);
    });
    const observer = new ResizeObserver(update);
    observer.observe(panel);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, []);

  return (
    <>
      <span ref={marker} hidden />
      {place &&
        createPortal(
          <button type="button" className="icon-btn card-corner" style={place} onClick={onClick} aria-label="Close the sign-in">
            <IconX size={20} />
          </button>,
          document.body,
        )}
    </>
  );
}
