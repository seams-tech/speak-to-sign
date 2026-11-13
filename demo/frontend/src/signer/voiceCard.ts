// Where the Wallet's voice card shows. An open dialog of the page can host the card as one of its
// own steps (WalletDialog): the dialog changes into the card, then back. With no host, the card
// shows in the Wallet's own modal, on top of the page.

import type { AnchoredWalletPresentation } from '@seams/wallet';
import { holdVoice } from '../voice/hold.ts';

/** The card's place over an element of the host's dialog, and the card's events. */
export type VoiceCard = AnchoredWalletPresentation;

/** The field of a Speak-to-Sign request that places its card. Empty: the Wallet's own modal. */
export type VoiceCardPlace = { presentation?: VoiceCard };

export interface VoiceCardHost {
  /** Shows the step of the card, calls `send` with the card's place, and gives its result. */
  show<T>(send: (card: VoiceCard) => Promise<T>): Promise<T>;
}

/** One try of a request, with its own card. */
export interface CardTry<T> {
  /** 1 for the first try. */
  number: number;
  /** Sends the request with the card's place. */
  send(card: VoiceCard): Promise<T>;
  /** False when a newer try took over: the host ended the card of this try for it. */
  newest(): boolean;
}

/**
 * The tries of one request. The result makes the next try. Each try sends the request again with
 * a new card, and the host ends the card of the try before it. So only the newest try settles
 * the request: an older try ends as cancelled, and that is not the result of the request.
 */
export function cardTries<T>(
  send: (card: VoiceCard) => Promise<T>,
  resolve: (result: T) => void,
  reject: (cause: unknown) => void,
): () => CardTry<T> {
  let count = 0;
  return () => {
    const number = ++count;
    const newest = () => number === count;
    return {
      number,
      newest,
      send: async (card) => {
        try {
          const result = await send(card);
          if (newest()) resolve(result);
          return result;
        } catch (cause) {
          if (newest()) reject(cause);
          throw cause;
        }
      },
    };
  };
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
