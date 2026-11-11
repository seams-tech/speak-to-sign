import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconX } from '@tabler/icons-react';
import { HostedSeamsAuthMenu, type HostedAuthMenuOutcome, type WalletStepEvents } from '@seams/wallet/react';
import { Modal, type ModalHandle } from './Modal';
import type { WalletCard } from './useWalletCard';

/**
 * Seams Wallet sign-in and registration. The menu runs inside the Wallet's own iframe, which the
 * SDK places over this element and keeps there while the element moves.
 */
function SignInMenu({
  onSignedIn,
  onCancel,
  events,
}: {
  onSignedIn: () => void;
  onCancel: () => void;
  /** For a menu that is a step of a dialog: what its card does. */
  events?: WalletStepEvents;
}) {
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
        {...events}
        onOutcome={onOutcome}
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
export function SignInModal({ onClose, onSignedIn }: { onClose: () => void; onSignedIn: () => void }) {
  const titleId = useId();
  const modal = useRef<ModalHandle>(null);

  // The Wallet's menu is its own card, so the dialog has no panel: the title is for screen
  // readers only, and Close sits on the card's corner.
  return (
    <Modal labelledBy={titleId} onClose={onClose} locked={false} bare handle={modal}>
      <h2 id={titleId} className="sr-only">
        Sign in to Seams Wallet
      </h2>
      <button type="button" className="icon-btn card-close" onClick={() => modal.current?.close()} aria-label="Close">
        <IconX size={20} />
      </button>
      <SignInMenu onSignedIn={() => modal.current?.close(onSignedIn)} onCancel={() => modal.current?.close()} />
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
  card,
  ended,
  onLeave,
}: {
  /** The id that labels the dialog. */
  titleId: string;
  /** The state of the menu's card, which the dialog keeps. */
  card: WalletCard;
  /**
   * The sign-in ended. The menu is gone, and its card fades out: the step keeps the card's size
   * until the dialog shows the step before.
   */
  ended: boolean;
  /** The visitor signed in, or went back. */
  onLeave: (signedIn: boolean) => void;
}) {
  return (
    <>
      <h2 id={titleId} className="sr-only">
        Sign in to Seams Wallet
      </h2>
      <div className="wallet-step" data-card-shown={card.shown || undefined} style={ended ? { minHeight: card.size?.height } : undefined}>
        {!ended && (
          <>
            <SignInMenu events={card.events} onSignedIn={() => onLeave(true)} onCancel={() => onLeave(false)} />
            <CardCorner onClick={() => onLeave(false)} />
          </>
        )}
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
