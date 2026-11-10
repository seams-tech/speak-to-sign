// The applications on the Speak-to-Sign page. A click on one opens it in a window on the page.
// Community Notes is live on NEAR testnet. The pull request screen works too, but its contract
// and the Wallet's merge request are not live yet. The voice multisig works against its testnet
// contract, and shows example data until the contract is deployed. All copy the style of the
// real apps, with neutral logos, inside a hand-drawn frame.

import { config } from '../config';

export type ExampleId = 'notes' | 'merge' | 'multisig';

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
    id: 'merge',
    chip: 'Merge a PR',
    title: 'Merge a pull request',
    say: 'merge pull request four hundred twelve into main',
    signs: 'approve({ pr: 412, head: "9c1e2fa", base: "main" })',
    target: 'a required check verifies it, then the merge runs',
    status: 'concept',
    blurb: 'The maintainer reads the intent aloud, so it is hard to merge the wrong PR by accident.',
    url: 'github.com/seams-tech/speak-to-sign/pull/412',
  },
  {
    id: 'multisig',
    chip: 'Confirm a multisig',
    title: 'Confirm a multisig transaction',
    say: 'approve proposal seven, send twenty five NEAR to grants dot testnet',
    signs: 'confirm({ proposal_id: 7, verdict_json, signature_b64 })',
    target: 'team.seams-v1.testnet · 0 NEAR · 30 Tgas · 2 of 3 needed',
    status: 'live',
    blurb: 'Each owner reads the amount and the receiver aloud. You cannot blind-sign what you must say, so a phishing transaction is harder to approve.',
    url: `${config.multisigContract}/transactions/queue`,
  },
];
