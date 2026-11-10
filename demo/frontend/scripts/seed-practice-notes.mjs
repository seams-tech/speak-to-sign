// Writes practice notes for the voice multisig page: invented harmful notes (spam, a phishing
// link, an insult, an address) on the practice post of the notes contract
// (src/multisig/practice.ts). A visitor of /multisig/ proposes to hide one by voice, and the two
// admins hide it. Run it when the page says that no reported note waits.
//
//   node scripts/seed-practice-notes.mjs <author-account> [count]
//
// The author signs each `add_note` with the key in ~/.near-credentials/testnet/<author>.json
// (0 deposit; the notes contract pays the storage). `count` is the number of notes, 8 by
// default, at most 40. Set NOTES_CONTRACT or NEAR_RPC_URL to use another contract or RPC.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { signAndSendCall } from '../src/faucet/nearTx.ts';
import { PRACTICE_NOTES, PRACTICE_POST_ID } from '../src/multisig/practice.ts';

const [author, countText = '8'] = process.argv.slice(2);
const count = Number(countText);
if (!author || !Number.isInteger(count) || count < 1 || count > 40) {
  console.error('Usage: node scripts/seed-practice-notes.mjs <author-account> [count from 1 to 40]');
  process.exit(1);
}
const contract = process.env.NOTES_CONTRACT || 'notes.seams-v1.testnet';
const rpcUrl = process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com';
const credentials = JSON.parse(readFileSync(join(homedir(), '.near-credentials', 'testnet', `${author}.json`), 'utf8'));
const key = credentials.private_key ?? credentials.secret_key;
if (typeof key !== 'string') {
  console.error(`No private key for ${author} in ~/.near-credentials/testnet.`);
  process.exit(1);
}

for (let index = 0; index < count; index += 1) {
  const note = PRACTICE_NOTES[index % PRACTICE_NOTES.length];
  const outcome = await signAndSendCall(rpcUrl, author, contract, key, {
    methodName: 'add_note',
    args: { post_id: PRACTICE_POST_ID, text: note.text, summary: note.summary },
    gas: 30_000_000_000_000n,
    deposit: 0n,
  });
  if (outcome.failure !== undefined) {
    console.error(`add_note failed: ${outcome.failure} (tx ${outcome.transactionHash})`);
    process.exit(1);
  }
  console.log(`note ${outcome.value} on post ${PRACTICE_POST_ID}: "${note.summary}" (tx ${outcome.transactionHash})`);
}
