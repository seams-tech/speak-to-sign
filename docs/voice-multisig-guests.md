# Voice multisig for new visitors: plan

Status: plan, 2026-11-10. Not built. It changes the demo of
`docs/voice-multisig.md`, which needs member accounts that are fixed at
deploy, so a new visitor cannot use it.

## Result

A visitor opens the multisig window and approves a real testnet transfer by
voice within about a minute:

1. The visitor clicks **Start a transfer**.
2. Two Seams signers approve it at once. They sign with a key and do not
   speak. The page labels them "Seams demo signers (key only)".
3. A team chat panel tells the visitor the transfer: "Send 0.01 NEAR to
   `<receiver>`".
4. The sign card shows "Approve proposal 12: send ___ NEAR to ___". The
   visitor says the sentence from memory.
5. The verifier checks the voice and the words. The visitor's Seams Wallet
   signs the confirmation.
6. The server executes the transfer. The page shows the receipt and the
   explorer link.

The visitor is the only voice signer. The proposal stays out of the chain
until the execute step, and the verifier holds it in OutLayer storage.

## Why key signers and not synthetic voices

| | Key signers (this plan) | Synthetic voices |
| --- | --- | --- |
| Verifier calls per visit | 2 (1 store, 1 voice) | 3 voice calls |
| Time before the visitor can sign | about 3 s (2 transactions) | about 15–25 s (2 TTS, 2 voice checks, 2 transactions) |
| New services | none | a text-to-speech service, 2 enrolled synthetic voices |
| Unknowns | none | Does ReDimNet tell two TTS voices apart? Does Whisper hear the TTS sentence exactly? Can Workers AI give 16 kHz mono WAV? |

Synthetic voices can come later, in place of the key step of each signer
(see "Later").

## Flow

```text
page            /api/multisig/start         verifier (OutLayer)     team contract
 | start {guest} ->|                             |                       |
 |                 | multisig_open {..., salt}  ->| stores the opening    |
 |                 |<- {commitment}               |                       |
 |                 | signer A: propose(id, commitment, guest) ----------->|
 |                 | signer B: confirm(id) ------------------------------>|
 |<- {id, commitment, receiver, amount}           |                       |
 | record; /api/voice-verify multisig_confirm --->| checks voice + words  |
 |<- signed verdict                               |                       |
 | Wallet: confirm_guest(id, verdict, signature) ------------------------>|
 | /api/multisig/execute {id} -> signer A: execute(id, receiver, amount, salt) ->|
```

## Changes

### Verifier 0.6.1 (`crates/voice-verifier`)

- Replace `multisig_propose` with `multisig_open`:
  `{ "op": "multisig_open", "multisig", "proposal_id", "receiver",
  "amount_yocto", "salt_hex" }`. It has no audio. It stores the opening and
  returns `{ "kind": "seams_voice_multisig_open_v1", "commitment" }`. A
  second open with the same commitment is a no-op.
- Only a holder of the Seams payment key can call it. The page route keeps
  only `multisig_confirm`.
- `multisig_confirm` does not change: the stored proposal, no digest or
  margin on a refusal, and 3 `words` refusals.
- Delete the voices list and the `same_speaker` refusal. Only one voice
  signs each proposal.
- Build, upload and add 0.6.1 as not active. Put its hash in
  `VOICE_OUTLAYER_VERSION_KEY`.

### Contract (`demo/contracts/voice-multisig`)

- `new(signers: AccountId[], verifier_public_key)`. The signers are the 2
  Seams accounts. Delete `threshold` and the voice members.
- `propose(proposal_id, commitment_hex, guest)`: a signer. No verdict. The
  guest is any account that is not a signer. The proposer is the first
  confirmation.
- `confirm(proposal_id)`: a signer who did not confirm yet. No verdict.
- `confirm_guest(proposal_id, verdict_json, signature_b64)`: only the guest
  of the proposal. The verdict check stays as it is, with the guest as the
  `owner` of the request digest.
- `execute`: a signer, after all signers and the guest confirmed. The
  commitment check, the transfer and the failure callback stay.
- A proposal expires 30 minutes after `propose`. After that,
  `confirm_guest` and `execute` refuse.
- `ProposalView` gets `guest`, `created_at_ms` and `guest_confirmed`.
- Update the unit tests and the sandbox test.

### Server routes (`demo/frontend/functions/api/`)

- `multisig/start` `{ guest }`:
  - It checks the account format and that the account exists.
  - It refuses with 409 if the guest has an open, unexpired proposal, and
    returns that proposal.
  - It refuses with 429 if more than 30 proposals were made in the last
    hour (from `get_proposals` and `created_at_ms`).
  - The id is `next_proposal_id`. If another start takes that id first, it
    tries again once.
  - The salt is `HMAC-SHA256(MULTISIG_SALT_SECRET, multisig || id)`, so the
    server keeps no state.
  - It calls `multisig_open`, then signer A `propose`, then signer B
    `confirm`.
- `multisig/execute` `{ proposal_id }`: if the guest confirmed and the
  proposal is open, signer A calls `execute` with the fixed receiver and
  amount and the salt again. Anyone can call it, and a second call does
  nothing.
- Both routes use `signAndSendCall` from `src/faucet/nearTx.ts`. Each
  signer key is a function-call key for the team contract only.

### Page (`demo/frontend/src/multisig/`)

- Delete the propose form and the Execute button. The opening in
  `localStorage` is not needed any more.
- New panels: **Start a transfer**, the team chat with the 2 signer ticks
  from the chain, the sign card with blanks, and the receipt.
- If the visitor has no voice enrolled, the sign card sends them to the
  setup panel. The setup panel enrolls the voice and funds the account from
  the faucet.
- The queue stays: the newest proposals, with their status.

### Accounts, funds and secrets

`seams-v1.testnet` holds 40.94 NEAR from the faucet accounts.

| Item | Value |
| --- | --- |
| Contract | `team.seams-v1.testnet`, 10 NEAR (2.4 NEAR for the code, the rest for transfers) |
| Signers | `signer-a.seams-v1.testnet`, `signer-b.seams-v1.testnet`, 1 NEAR each for gas |
| Receiver | A Seams account with a name that the grammar can speak. We move its NEAR back to the contract from time to time. |
| Amount | 0.01 NEAR for each visit, about 3,000 visits with the current funds |
| Pages secrets | `MULTISIG_SIGNER_A_KEY`, `MULTISIG_SIGNER_B_KEY`, `MULTISIG_SALT_SECRET`, plus the 6 `VOICE_OUTLAYER_*` secrets (already set) |

## Limits

- A visitor can start a transfer for an account that is not theirs. Only
  the owner of that account can confirm it, with their voice and their key.
  The cost of such a start is 1 store call and 2 transactions, and the
  hourly cap limits it.
- The visitor reads the transfer in the chat before saying it. So in this
  demo, recall shows the flow but does not protect against a swapped page.
  A real team uses voice members and its own channel, as in
  `docs/voice-multisig.md`.
- The page route and the server use the Seams staging payment key. Each
  visit costs 1 voice check on that key.

## Steps

1. Verifier 0.6.1, with its tests. Build, upload, and add it as not active.
2. The contract, with its unit tests and the sandbox test.
3. The server routes, with tests for the salt, the caps and the retry.
4. The page, with a check in the browser against the sandbox or testnet.
5. Deploys, each with the owner's go-ahead: the signer accounts and their
   keys, the contract and its funds, the Pages secrets, and a Pages deploy.
6. A live run with a real visitor voice. Record the times and the
   transaction hashes.

## Later: synthetic signer voices

Replace the key step of each signer with a spoken step. Workers AI lists
`@cf/deepgram/aura-1` with 12 voices and `linear16` / `wav` output. The docs
do not list the sample rates. First measure: the 16 kHz WAV output, the
speaker score of each voice against its own template and against the other
voice, and the exact Whisper match.

## Open questions

1. Does the Seams staging project let the Wallet sign a call to
   `team.seams-v1.testnet`, or does it need an allowed-contract entry?
2. Which receiver account, with a name that the grammar can speak?
3. Is OutLayer storage readable only by the worker? This question from
   `docs/voice-multisig.md` is still open.
