// Where the Wallet's voice card shows. An open dialog of the page can host the card as one of its
// own steps (WalletDialog): the dialog changes into the card, then back. With no host, the card
// shows in the Wallet's own modal, on top of the page.

import type { AnchoredWalletPresentation } from '@seams/wallet';
import { holdVoice } from '../voice/hold';

/** The card's place over an element of the host's dialog, and the card's events. */
export type VoiceCard = AnchoredWalletPresentation;

/** The field of a Speak-to-Sign request that places its card. Empty: the Wallet's own modal. */
export type VoiceCardPlace = { presentation?: VoiceCard };

export interface VoiceCardHost {
  /** Shows the step of the card, calls `send` with the card's place, and gives its result. */
  show<T>(send: (card: VoiceCard) => Promise<T>): Promise<T>;
}

/** The open hosts, newest last. The newest one shows the card. */
const hosts: VoiceCardHost[] = [];

/** Registers an open dialog as a host. The result unregisters it. */
export function hostVoiceCard(host: VoiceCardHost): () => void {
  hosts.push(host);
  return () => {
    hosts.splice(hosts.indexOf(host), 1);
  };
}

/**
 * Runs one Speak-to-Sign request with its card in the newest host's dialog:
 * `inVoiceCard((place) => seams.near.spoken.note({ ...note, ...place }))`. The host holds the
 * voice bar while its card can record. A card in the Wallet's own modal holds it all the time:
 * the page cannot see the stage of that card.
 */
export async function inVoiceCard<T>(send: (place: VoiceCardPlace) => Promise<T>): Promise<T> {
  const host = hosts[hosts.length - 1];
  if (host) return await host.show((card) => send({ presentation: card }));
  const release = holdVoice('recording');
  try {
    return await send({});
  } finally {
    release();
  }
}
