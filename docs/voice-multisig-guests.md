# Voice multisig for new visitors: plan

Status: built and deployed on testnet at `multisig.seams-v1.testnet`, 2026-11-10, with no cap.
The first deploy, at `team.seams-v1.testnet`, had a cap and is replaced. It changes the demo of
`docs/voice-multisig.md`.
That design needs member accounts that are fixed at deploy, so a new visitor
cannot use it.

## Result

A visitor opens the multisig window and moves a small amount of testnet NEAR
with one spoken approval:

1. The visitor types a transfer, for example "0.01 NEAR to
   `seams-grants.testnet`", and reads it aloud: "approve proposal twelve,
   send zero point zero one NEAR to seams dash grants dot testnet".
2. Verifier 0.6.0 checks the voice and the words. It keeps the transfer in
   OutLayer storage and returns the commitment and the salt to the page.
3. The visitor's Seams Wallet signs `propose`. The chain holds only the
   commitment.
4. The page sends the opening to `/api/multisig/approve`. The two admin
   accounts approve the proposal with normal signed transactions, as in any
   multisig. Then admin B calls `execute`.
5. The page shows the voice approval, the two admin approvals and the
   receipt with the explorer link.

Only the visitor needs VoiceID and Speak-to-Sign. The admins are plain key
signers. For the demo, the page shows them as signers like the visitor,
"Admin A" and "Admin B", with no key icon and no words about keys. This
document keeps the true design for maintainers.

The verifier does not change. The route uses 0.6.0, which is on OutLayer
with the version key in the Pages secrets.

## Contract (`demo/contracts/voice-multisig`)

| Method | Kind | Arguments | Rule |
| --- | --- | --- | --- |
| `new` | init, private | `admins: AccountId[]`, `verifier_public_key` | 1 to 10 distinct admins. The key is `ed25519:<base58 of 32 bytes>`. |
| `propose` | change | `proposal_id`, `commitment_hex`, `verdict_json`, `signature_b64` | Any account that is not an admin. `proposal_id` equals `next_proposal_id`. The verdict check is the current one, with the caller as `owner`. The caller is the proposer. Returns the id. |
| `approve` | change | `proposal_id` | An admin who did not approve yet. The proposal is open. No verdict. Returns the number of admin approvals. |
| `execute` | change | `proposal_id`, `receiver`, `amount_yocto`, `salt_hex` | The proposer or an admin. All admins approved. No cap: the grammar's range applies (0.01 to 1,000,000 NEAR). The commitment check, the transfer and the failure callback stay. An amount above the balance fails in this call ("Exceeded the account balance."), and the proposal stays open. |
| `get_proposal` | view | `proposal_id` | `ProposalView` or `null` |
| `get_proposals` | view | `from_index?`, `limit?` (at most 50) | Newest first |
| `get_config` | view | — | `{ admins, verifier_public_key }` |
| `next_proposal_id` | view | — | Starts at 1 |

`ProposalView`:

```json
{
  "id": 12,
  "commitment_hex": "<64 lowercase hex>",
  "proposer": "visitor.testnet",
  "approvals": ["admin-a.seams-v1.testnet", "admin-b.seams-v1.testnet"],
  "status": "executed",
  "created_at_ms": 1794300000000,
  "receiver": "seams-grants.testnet",
  "amount_yocto": "10000000000000000000000"
}
```

- `status` is `open` or `executed`. `receiver` and `amount_yocto` appear
  only after the transfer arrives.
- Events: NEP-297, standard `voice_multisig`, version `2.0.0`: `proposed`,
  `approved`, `executed`, `execute_failed`.
- Delete `threshold`, the voice members, `confirm` and its rules. A
  confirm by voice can come back later (see "Later").
- No change method accepts a deposit. The contract gets its NEAR by a
  plain transfer.

## Route `/api/multisig/approve` (`demo/frontend/functions/api/multisig/approve.ts`)

- Input: `{ proposal_id, receiver, amount_yocto, salt_hex }`. Same-origin
  requests only, as in the other routes.
- It reads the proposal and the config. It refuses with 404 if there is no
  proposal, and with 409 if the proposal is executed. It sets no cap. A
  config of another shape (for example the one of `team.seams-v1.testnet`,
  with `max_amount_yocto`) stops the run at the step `read`.
- Admin A calls `approve` if it did not approve yet. Then admin B does the
  same. Then admin B calls `execute`.
- Output: `{ proposal, executeTransactionHash, executed }`. `executed` is
  the boolean result of the callback. On a failure it returns `{ error }`
  and the step that failed. A second call continues from the first step
  that is not done.
- It signs with `signAndSendCall` from `src/faucet/nearTx.ts`. Each admin
  key is a function-call key for `approve` and `execute` on the multisig
  contract only.
- Settings: `MULTISIG_ADMIN_A_KEY` and `MULTISIG_ADMIN_B_KEY` (secrets),
  `MULTISIG_ADMIN_A` (default `admin-a.seams-v1.testnet`),
  `MULTISIG_ADMIN_B` (default `admin-b.seams-v1.testnet`),
  `MULTISIG_CONTRACT` (default `multisig.seams-v1.testnet`), `NEAR_RPC_URL`.
- `/api/voice-verify` takes only `multisig_propose` now.

## Page (`demo/frontend/src/multisig/`)

- The window opens on the **New proposal** tab: receiver, amount (default
  0.01 NEAR, no cap), record, verify, and the Wallet `propose`. The hint
  under the sentence says: "You can say “dot” or “point”, and you can
  leave out “dash”." The verifier change that makes these forms match is
  separate work in `crates/`.
- After `propose`, call the approve route. Show three ticks: your
  approval, Admin A and Admin B. Then show the receipt.
- Keep the opening in `localStorage` until the transfer is executed. If the
  route fails, the page shows **Finish the transfer**, which calls the
  route again.
- Delete the confirm panel, the blank sentence and the Execute button.
- No **Queue** tab. **History** lists the open and the executed
  proposals, newest first, with their approvals. An open proposal shows
  **Finish the transfer** there when this browser holds its opening.
- The side list says "Signers · all approve", with Admin A and Admin B.
- The views parse accepts exactly `{ admins, verifier_public_key }`. A
  config of another shape shows "The multisig contract answered in an
  unexpected form." inside the window.
- If the visitor has no voice enrolled or no NEAR for gas, the page sends
  them to the setup panel, which enrolls the voice and calls the faucet.

## Accounts, funds and secrets

Created on 2026-11-10. `seams-v1.testnet` paid for them from the NEAR of four faucet accounts.

| Item | Value |
| --- | --- |
| Contract | `multisig.seams-v1.testnet`, deployed 2026-11-10: account tx `L46kDchYKrKdv3RAko55ycrAiATK95J8EigcoVQYg5Q` (3 NEAR from `seams-v1.testnet`), 7.5 NEAR from `team.seams-v1.testnet` (tx `9o2d3MzLJZY3HxXjRL7MFbzQUuu5rcXayMj5RVQsk4rk`), deploy and `new` tx `BcBCruDvJ5MCyDPxRKqm7BCCXgUuyr1NfmeFXXZg6Dwz`, code `c3f420b8…e037` (230,376 bytes, no cap). About 10.5 NEAR. |
| First contract | `team.seams-v1.testnet`, replaced by `multisig.seams-v1.testnet`. It stays on chain. 10 NEAR: about 2.32 NEAR for the code, the rest for transfers. Account tx `F8wtPJxzDgTzzjd97CN5QvoMJKghUUR8Z6SngB6jnV3R`, deploy and `new` tx `HQb3jQNDd4CaYxV74apRRadjSeWtHxN2mRCSweVz7rX3`, code `d82479ab…e327`, with a cap |
| Admins | `admin-a.seams-v1.testnet` (tx `24QhwvkVun5RQU6wSQPFtgduoJyTvZjwQDjG6b7a8GKV`) and `admin-b.seams-v1.testnet` (tx `4cW3rugEmbBYjnGHkqqu18pWZyKXmmRnkfHpVspysSSF`), 1 NEAR each for gas. Each has one function-call key for `approve` and `execute` on `multisig.seams-v1.testnet`, with a 0.5 NEAR allowance (A `ed25519:EpSb7qgZ…J3ae`, tx `Efg5YLHLaaNc5eYikP1eyq4fyFyprHkexLARZXX7rD33`; B `ed25519:9KukESTL…8evs`, tx `HoFDcSB6KnQQFM4pgzTeeNByRxqs8rYnJtsmbRpjDMp3`). These keys are in the Pages secrets. The keys for `team.seams-v1.testnet` are deleted. |
| Cap | None. The first contract had 0.05 NEAR for each proposal. |
| Default receiver | `seams-grants.testnet`, a Seams account made with the testnet faucet (tx `9BsVsGvPeyhVzrKPVCQ6CGrx4pZk8H3EyAekBfuP71Ue`). We move its NEAR back from time to time. |
| Pages secrets | `MULTISIG_ADMIN_A_KEY`, `MULTISIG_ADMIN_B_KEY` and the 6 `VOICE_OUTLAYER_*` secrets, all set in production |
| Pages deploy | Production deployment `8cae765b` of commit `5fd7cc7`, built from a clean `git archive` of the commit. Both routes answer with their secrets, and the window reads `team.seams-v1.testnet`. The page for `multisig.seams-v1.testnet` needs a new Pages deploy. |

## Limits

- The admins approve a commitment that they cannot read. In a real team,
  each member says the transfer from memory (`docs/voice-multisig.md`).
- There is no cap. One spoken proposal can move all the NEAR of the
  multisig, so keep its balance small (10 NEAR). Each proposal needs an
  enrolled voice and a voice check, so the cost of abuse is bounded. A
  transfer above the balance fails, and the proposal stays open.
- Each proposal costs 1 voice check on the Seams staging payment key and
  about 3 admin transactions of gas.

## Steps

1. The contract, with its unit tests and the sandbox test.
2. The approve route and the page, with unit tests for the route steps and
   a check in the browser.
3. Deploys, each with the owner's go-ahead: the admin accounts and their
   keys, `seams-grants.testnet`, the contract and its funds, the Pages
   secrets, and a Pages deploy.
4. A live run with a real voice. Record the times and the transaction
   hashes.
5. Done on 2026-11-10: the contract with no cap at
   `multisig.seams-v1.testnet`, its funds, a new function-call key for each
   admin, the two Pages secrets and a Pages deploy. Verifier 0.6.1 reads
   "point" for "dot" and a left-out "dash" in the spoken proposal.

## Later: admins that confirm by voice

Give each admin a synthetic voice, and let it confirm with
`multisig_confirm` of verifier 0.6.0, from memory. The verifier needs no
change; the contract gets `confirm` back. Workers AI lists
`@cf/deepgram/aura-1` with 12 voices and `linear16` / `wav` output. First
measure the 16 kHz output, the speaker score of each voice against its own
template and against the other voice, and the exact Whisper match.

## Open questions

1. Does the Seams staging project let the Wallet sign a call to
   `multisig.seams-v1.testnet`, or does it need an allowed-contract entry?
2. Is OutLayer storage readable only by the worker? This question from
   `docs/voice-multisig.md` is still open.
