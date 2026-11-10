// The applications of the Speak-to-Sign site. Each one has its own page: Community Notes at /,
// the voice multisig at /multisig/. A click on the app's screen opens it in a window on its page.
// Community Notes is live on NEAR testnet. The voice multisig moderates the notes: it hides a
// reported note, or sends NEAR. It works against its testnet contract, and shows example data if
// the contract account has no code. Both copy the style of
// the real apps, with neutral logos, inside a hand-drawn frame.

import { config } from '../config';

export type ExampleId = 'notes' | 'multisig';

/** The page of each example. The HTML file of a page sets `data-page` on <html>. */
export const PAGE_PATH: Record<ExampleId, string> = {
  notes: '/',
  multisig: '/multisig/',
};

export interface VoiceExample {
  id: ExampleId;
  /** The chip on the voice card. */
  chip: string;
  title: string;
  /** The sentence that the owner reads aloud. */
  say: string;
  /** What the Wallet signs after the verifier accepts the voice. */
  signs: string;
  /** Where the signature goes. */
  target: string;
  status: 'live' | 'concept';
  blurb: string;
  /** The address in the drawn browser bar. */
  url: string;
}

export const EXAMPLES: VoiceExample[] = [
  {
    id: 'notes',
    chip: 'Rate a note',
    title: 'Community Notes',
    say: 'this note is helpful',
    signs: 'rate_note({ note_id: 2, rating: "helpful" })',
    target: 'notes.seams-v1.testnet · 0 NEAR · 30 Tgas',
    status: 'live',
    blurb: 'Rate or post a note by voice, on an X-style page.',
    url: 'x.com',
  },
  {
    id: 'multisig',
    chip: 'Hide a note',
    title: 'Moderate notes with a multisig',
    say: 'approve proposal twelve hide note forty two',
    signs: 'propose({ proposal_id: 12, commitment_hex, verdict_json, signature_b64 })',
    target: 'multisig.seams-v1.testnet · 0 NEAR · 30 Tgas · then Admin A and Admin B approve, and the multisig calls hide_note',
    status: 'live',
    blurb: 'Readers reported a harmful note. You propose to hide it by voice, two admins approve, and the multisig hides it. One stolen key cannot hide a note alone.',
    url: `${config.multisigContract}/transactions/new`,
  },
];
