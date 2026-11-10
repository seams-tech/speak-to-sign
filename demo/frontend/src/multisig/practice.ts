// The practice notes of the voice multisig page. Readers reported these notes as harmful: spam,
// a fake phone number, an insult, a phishing link. They are on one post of the notes contract
// that no page shows as a post. A visitor proposes "hide note N" by voice, and the two admins
// approve and run it. The admins (functions/api/multisig/approve.ts) refuse a note on any other
// post, so a visitor cannot hide a real note of the Community Notes page.
// scripts/seed-practice-notes.mjs writes new practice notes when they run out.

/** The post of the practice notes on the notes contract. */
export const PRACTICE_POST_ID = 900;

/** The notes that the seed script writes, in turn. All of it is invented. */
export const PRACTICE_NOTES: { text: string; summary: string }[] = [
  { text: 'Call 555-0142 now and win 100 NEAR! Only today, only for the first ten callers.', summary: 'Call now to win 100 NEAR' },
  { text: 'Free tokens for all readers at totally-real-airdrop.example. Connect your wallet and sign the claim.', summary: 'Free tokens, connect your wallet' },
  { text: 'Everyone who believes this post is an idiot. Do not reply, idiots.', summary: 'Readers of this post are idiots' },
  { text: 'The poster lives at 12 Example Lane. Go there and ask them yourself.', summary: 'Home address of the poster' },
];
