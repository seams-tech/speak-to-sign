// Picks the signer and the notes store.
//
// Mock mode (VITE_NOTES_CONTRACT is empty): the mock signer and the mock store
// share one in-memory contract.
//
// Contract mode: the notes come from the contract views on NEAR testnet RPC.
// THE REAL SIGNER GOES HERE. Replace `notConnectedSigner` with an adapter
// over `seams.speakToSign.requestNote` and `seams.speakToSign.requestRating`
// (Seams Wallet SDK 0.59.0) that returns the `SignResult` shapes in
// ./signer/notesSigner.ts. Give `setup` the Wallet's sign-in, VoiceID and
// enroll steps, so the setup panel shows their buttons.

import { config } from './config';
import { RpcNotesStore } from './notes/rpcStore';
import type { NotesStore } from './notes/types';
import { MockBackend, type MockControls } from './signer/mockBackend';
import type { NotesSigner, SignerSetup } from './signer/notesSigner';

export interface Services {
  signer: NotesSigner;
  setup: SignerSetup;
  store: NotesStore;
  /** Only in mock mode. */
  mock: MockControls | null;
}

const NOT_CONNECTED = 'This page has no Seams Wallet signer yet.';

const notConnectedSigner: NotesSigner = {
  status: async () => ({ signedIn: false, voiceReady: false }),
  requestNote: async () => ({ kind: 'unavailable', reason: NOT_CONNECTED }),
  requestRating: async () => ({ kind: 'unavailable', reason: NOT_CONNECTED }),
};

export function createServices(): Services {
  if (config.mock) {
    const backend = new MockBackend();
    return { signer: backend.signer, setup: {}, store: backend.store, mock: backend.controls };
  }
  return {
    signer: notConnectedSigner,
    setup: {},
    store: new RpcNotesStore(config.rpcUrl, config.contract),
    mock: null,
  };
}
