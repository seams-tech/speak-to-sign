# Voice multisig: each member recalls the intent

Status: plan and build spec, 2026-11-10. Testnet only. Everything is in this
repository: the grammar, the verifier, a demo contract and the demo page.
Nothing in `seams-wallet` changes.

The demo for new visitors changes this design: two Seams signers approve
by key, and the visitor is the one voice signer. The plan is
`docs/voice-multisig-guests.md`.

## Result

A NEAR multisig on testnet where each confirmation is a spoken intent, not a
click.

- The proposer types a transfer and reads it aloud. The verifier keeps the
  plain proposal in OutLayer storage. The chain gets only a salted hash of it,
  the commitment.
- Each other member must say the intent from memory: "approve proposal seven,
  send twenty five NEAR to grants dot testnet". The member's page shows the
  sentence with blanks for the amount and the receiver. The member must know
  them from the team's own decision.
- The verifier checks the words against the stored proposal with the same
  exact `spoken-intent` match that every other kind uses. No model decides
  that two statements mean the same thing.
- The verifier refuses a confirmation when the voice matches a member who
  already confirmed. So N confirmations need N different voices.
- The contract checks each signed verdict on chain. At the threshold, a
  member who confirmed executes the transfer.

**Why recall and not read-aloud.** If the page shows the sentence, a
compromised page or a malicious proposer can show a different transaction,
and the member reads it. If the member must recall the intent, a swapped
transaction fails: the member says what the team agreed, and those words do
not match the stored proposal.

## Why the contract checks the verdict

The other demos send the verdict to Seams Wallet core and the Seams
co-signer, which rebuild the request from the transaction. A new kind there
needs a Wallet release. Here the contract checks the verdict instead:

1. The verdict signature, with the verifier key that `new` pins.
2. `kind` is `seams_voice_signed_verdict_v2` and `outcome` is `accept`.
3. `expires_at_ms` is not before the block time.
4. `request_digest` is `multisig_approval_digest(testnet, predecessor,
   current account, proposal_id, commitment)` from the `spoken-intent`
   crate, which the contract links.

The member signs `propose` or `confirm` as a normal function call with Seams
Wallet (`seams.near.signAndSendTransaction`, the passkey confirm step). The
voice check is on chain, so it does not depend on the wallet.

## Grammar (`crates/spoken-intent`), done

- `SpokenRequestV1::MultisigApproval` (tag 1) is `{ network, owner,
  multisig, proposal_id, proposal, salt }`. The challenge words are gone: a
  member can confirm a proposal only once, so a replayed recording gains
  nothing.
- `render` gives "Approve proposal 7: send 25 NEAR to grants.testnet" and the
  spoken words "approve proposal seven send twenty five near to grants dot
  testnet".
- `multisig_commitment(multisig, proposal_id, proposal, salt)` =
  `sha256("seams:spoken-intent:multisig-commitment:v1" || borsh(multisig,
  proposal_id, proposal) || salt)`.
- `request_digest` of this kind is `multisig_approval_digest(network, owner,
  multisig, proposal_id, commitment)` = `sha256("seams:spoken-intent:request:v1"
  || 1 || borsh(network, owner, multisig, proposal_id, commitment))`. It holds
  the commitment, not the proposal, so the contract computes it from its
  state.

## Verifier (`crates/voice-verifier`)

Two new request kinds of the `verify` op:

```json
{ "kind": "multisig_propose", "multisig": "team.seams-v1.testnet", "proposal_id": 1,
  "receiver": "grants.testnet", "amount_yocto": "25000000000000000000000000" }
{ "kind": "multisig_confirm", "multisig": "team.seams-v1.testnet", "proposal_id": 1,
  "commitment_hex": "<64 lowercase hex>" }
```

- `multisig_propose`: draws a 32-byte salt and builds the request. If the
  voice and the words pass, it stores the proposal and the salt, and adds the
  owner to the voices of the proposal. Two proposals with one id can both be
  stored; the contract accepts only the first `propose`.
- `multisig_confirm`: loads the opening by `multisig` and `commitment_hex`,
  and refuses `proposal_missing` if there is none or if `proposal_id`
  differs. It builds the request with the stored proposal and salt.
- On the accept of a proposal, the output has `"multisig": { "commitment",
  "salt" }` (base64url) and no stage times. Every output must stay below
  1,024 bytes, and this is what fits. No output of a confirmation holds the
  salt. So the proposer's page, which has the receiver and the amount, calls
  `execute`.

Rules for both kinds:

1. **Exact words.** `words_pass` stays exact. Only `Transfer` proposals
   exist: the other kinds change the member set.
2. **No leak on refusal.** For `multisig_confirm`, the verdict sets
   `spoken_text_digest` and `word_margin_milli` only on accept. Without this
   rule, a member could hash each likely sentence and compare. `heard` stays:
   it is what the member said.
3. **Attempt limit.** A `words` refusal of `multisig_confirm` adds 1 to the
   tries of that member and proposal. At 3 tries the verifier refuses
   `attempts_exhausted` before it runs the checks. Only a refusal after the
   speaker check passed counts, so a stranger cannot use up a member's tries.
4. **Different voices.** After the speaker check passes, the verifier scores
   the embedding against the template of each other owner in the voices of
   the proposal. A score that passes `speaker_passes` refuses `same_speaker`.
5. New reasons: `same_speaker`, `attempts_exhausted`, `proposal_missing`.

Storage keys (the verifier's OutLayer storage):

| Key | Value |
| --- | --- |
| `msig1:<multisig>:<commitment b64u>:open` | JSON `{ proposal_id, receiver, amount_yocto, salt_hex }` |
| `msig1:<multisig>:<commitment b64u>:voices` | JSON array of owners whose verdict was an accept |
| `msig1:<multisig>:<commitment b64u>:tries:<owner>` | decimal count of `words` refusals |

The verifier version with these kinds is 0.6.0.

`policy::decide` allows both kinds.

## Contract (`demo/contracts/voice-multisig`)

near-sdk 5.30.1, Rust 1.97.0,
unit tests, a sandbox test and a pinned build. It links `spoken-intent` by
path. Members are `predecessor_account_id`. Only `execute` moves value. No
change method accepts a deposit. The multisig gets its NEAR by a plain
transfer to its account.

| Method | Kind | Arguments | Rule |
| --- | --- | --- | --- |
| `new` | init | `members: AccountId[]`, `threshold: u8`, `verifier_public_key: "ed25519:<base58>"` | 2 to 10 distinct members, threshold 1 to the member count. |
| `propose` | change | `proposal_id: u64`, `commitment_hex`, `verdict_json`, `signature_b64` | Member. `proposal_id` equals `next_proposal_id`. A valid verdict for this commitment. Counts as the proposer's confirmation. |
| `confirm` | change | `proposal_id`, `verdict_json`, `signature_b64` | Member, once per proposal. A valid verdict for the stored commitment. Proposal still open. |
| `execute` | change | `proposal_id`, `receiver: AccountId`, `amount_yocto: U128`, `salt_hex` | A member who confirmed. Confirmations at or above threshold. The commitment of `Transfer { receiver, amount }` with the salt equals the stored one. Marks the proposal executed, sends the NEAR, and a callback sets it back to open if the transfer fails. |
| `get_proposal` | view | `proposal_id` | `{ id, commitment_hex, proposer, confirmations: AccountId[], status, receiver?, amount_yocto? }`. `receiver` and `amount_yocto` only after a successful execute. |
| `get_proposals` | view | `from_index`, `limit` (at most 50) | Newest first. |
| `get_config` | view | — | `{ members, threshold, verifier_public_key }` |
| `next_proposal_id` | view | — | Starts at 1. |

Each change logs a NEP-297 event, standard `voice_multisig`, version
`1.0.0`: `proposed`, `confirmed`, `executed`, `execute_failed`.

## Demo page (`demo/frontend`)

- `/multisig/`: a live screen in a neutral multisig-queue style. The
  showcase example becomes `live`, with a NEAR sentence.
- **Propose:** receiver and amount, record, `multisig_propose`, then sign
  `propose`. The page then says "Tell the other members: send 25 NEAR to
  grants.testnet" and keeps the opening in `localStorage` for `execute`.
- **Confirm:** the queue from `get_proposals`. For an open proposal the page
  shows "Approve proposal 7: send ___ NEAR to ___". The member records,
  `multisig_confirm`, then signs `confirm`.
- **Execute:** when the confirmations reach the threshold, the proposer's
  page, which holds the opening, signs `execute`.
- The page records the microphone itself: a 16 kHz mono PCM16 WAV of at most
  8 s.
- `functions/api/voice-verify.ts` sends the input to the OutLayer verifier
  with the demo's own OutLayer payment key, as the Seams verify route does.
  It accepts only the two multisig kinds. The Seams route checks that the
  caller owns `owner`; this route cannot. The voice check and the contract's
  predecessor check still bind each verdict to the owner's voice and key.
- Over HTTPS, the verifier's storage cell and its verdict key come from the
  payment-key owner. The members enrolled their voices through the Seams
  staging server. So the route must use the same OutLayer payment key as
  that server, or every verify refuses `template_missing`. With that key the
  verdict key is `ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U`,
  which the contract pins.

## Threats and limits

| Threat | What stops it | What is left |
| --- | --- | --- |
| A page shows a swapped transaction | Recall: the member says the agreed intent | — |
| A member guesses the hidden amount | Salt; three tries; no digest or margin in a refusal | A member who confirmed knows the opening and can tell others |
| One person controls several member accounts | The different-voices rule | A clone of another member's voice |
| A verdict of one member used by another | `owner` is in the digest; the contract checks the predecessor | — |
| A stranger calls the demo verify route | Each verdict needs the owner's voice; the contract needs the owner's key | Cost of the OutLayer calls |
| The verifier loses an opening | Confirmations refuse `proposal_missing` | Members propose again |
| The proposer's page loses the salt | — | The proposal cannot execute; members propose again |

The proposal is hidden from the chain and from the members' pages until
`execute`. It is not hidden from the proposer or from the OutLayer worker.

## Open questions

1. Is OutLayer storage readable only by the worker? Check the OutLayer docs
   before the page claims that the proposal is hidden.
2. Is the speaker cutoff safe as a refusal cutoff between two members, or
   does it refuse two different people with similar voices? Measure it with
   the enrolled test voices.
3. Deploys: the verifier 0.6.0 and the page's OutLayer secrets are done
   (2026-11-10; 0.6.0 is added but not active, and the route selects it by
   version key). The contract (`team.seams-v1.testnet`) waits for the member
   list.
4. The 1,024-byte output cap comes from the on-chain OutLayer path, which the
   verifier no longer uses. If the HTTPS path allows more, a confirmation can
   also return the salt, so that any member who confirmed can execute.
