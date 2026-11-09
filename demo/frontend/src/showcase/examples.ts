// The applications on the Speak-to-Sign page. A click on one opens it in a window on the page.
// Community Notes is live on NEAR testnet. The pull request screen works too, but its contract
// and the Wallet's merge request are not live yet. The multisig screen is a drawing. All copy
// the style of the real apps, with neutral logos, inside a hand-drawn frame.

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
    blurb: 'A required check waits for the maintainer\'s voice before main can move.',
    url: 'github.com/seams-tech/speak-to-sign/pull/412',
  },
  {
    id: 'multisig',
    chip: 'Confirm a multisig',
    title: 'Confirm a multisig transaction',
    say: 'confirm transaction seven, send twenty five thousand USDC to grants dot eth',
    signs: 'confirm(safeTx #7, hash 0x4f2a…91bd)',
    target: 'one owner confirmation · 2 of 3 needed',
    status: 'concept',
    blurb: 'Each owner confirms by voice. The words must match the amount and the receiver.',
    url: 'app.safe.global/transactions/queue',
  },
];
