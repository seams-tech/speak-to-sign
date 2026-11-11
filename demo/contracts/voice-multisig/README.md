# Voice multisig contract

A NEAR multisig for the voice multisig demo (`demo/frontend`, `/multisig/`).
Any account that is not an admin proposes a transfer, or "hide note N" for a
harmful community note, with its own spoken approval. It reads the proposal
aloud, and the verifier checks the voice and the words and signs a verdict.
This contract checks the verdict on chain. Then each admin approves the
proposal with a plain signed call, and the proposer or an admin executes it.
The chain holds only a salted hash of the proposal, the commitment, until
`execute`. For a hide, this contract is the moderator of the notes contract
(`../community-notes/`) that `set_notes_contract` names, and `execute`
calls its `hide_note`. The contract has no cap: a
transfer is any amount that the grammar can speak (0.01 to 1,000,000 NEAR),
and the balance of the multisig limits it. Testnet only.

The specification is in `docs/voice-intents-spec.md`, section 10. The
sequence diagram is in `docs/architecture.md`, section 7.

## Toolchain

Rust 1.97.0 (`rust-toolchain.toml`),
near-sdk 5.30.1, near-workspaces 0.24.0 with the nearcore 2.14.0 sandbox.
`.cargo/config.toml` adds `--cfg near` to each WASM build, so a failed call
keeps its message on chain. The contract links `crates/spoken-intent` by
path for the commitment and the request digest.

## Interface

The caller is `predecessor_account_id`. Ids are JSON numbers. Amounts are
yoctoNEAR as decimal strings (`U128`). No change method accepts a deposit:
a call with a deposit fails. The multisig gets its NEAR by a plain transfer
to its account.

| Method             | Kind     | Arguments | Returns |
| ------------------ | -------- | --------- | ------- |
| `new`              | init     | `{"admins": AccountId[], "verifier_public_key": "ed25519:<base58>"}` | — |
| `propose`          | change   | `{"proposal_id": u64, "commitment_hex": String, "verdict_json": String, "signature_b64": String}` | `u64`, the proposal id |
| `approve`          | change   | `{"proposal_id": u64}` | `u32`, the number of admin approvals |
| `execute`          | change   | `{"proposal_id": u64, "receiver": AccountId, "amount_yocto": U128, "salt_hex": String}` for a transfer, or `{"proposal_id": u64, "note_id": u64, "salt_hex": String}` for a hide | `bool`: `true` if the transfer arrived or the note is hidden, `false` if it failed |
| `on_transfer`      | callback | private | `bool` |
| `on_hide`          | callback | private | `bool` |
| `set_notes_contract` | change, private | `{"account_id": AccountId}` | nothing |
| `get_notes_contract` | view   | `{}` | `AccountId` or `null` |
| `get_proposal`     | view     | `{"proposal_id": u64}` | `ProposalView` or `null` |
| `get_proposals`    | view     | `{"from_index"?: u64, "limit"?: u32}` | `ProposalView[]`, newest first |
| `get_config`       | view     | `{}` | `{"admins", "verifier_public_key"}` |
| `next_proposal_id` | view     | `{}` | `u64`, starts at 1 |

Rules:

- `new`: only the contract account can call it, in the deploy transaction.
  1 to 10 distinct admins. The verifier key is `ed25519:` and the base58
  text of 32 bytes.
- `propose`: the caller is any account that is not an admin, and it becomes
  the proposer. An admin approves by key, so it cannot also be the voice
  that proposes. `proposal_id` equals `next_proposal_id`. `commitment_hex`
  is 64 lowercase hex characters. The verdict is valid for the caller and
  this commitment (see below). The proposal starts with no approvals.
- `approve`: the caller is an admin who did not approve yet. The proposal is
  open. The call has no verdict.
- `execute`: the proposal is open. The caller is the proposer or an admin.
  All admins approved.
  `receiver` is a named account that the grammar can speak (not implicit,
  not `0x`). `amount_yocto` is a multiple of 0.01 NEAR from 0.01 to
  1,000,000 NEAR. `salt_hex` is 64 lowercase hex characters.
  `multisig_commitment(current account, proposal_id, Transfer { receiver,
  amount }, salt)` equals the stored commitment. The contract marks the
  proposal `executed` and sends the NEAR. If the transfer fails, the NEAR
  comes back and the callback sets the proposal to `open` again. The
  approvals stay, so the proposer or an admin can execute it again. If
  `amount_yocto` is above the balance of the multisig, the runtime refuses
  the transfer in the `execute` call itself ("Exceeded the account
  balance."). The call fails, no callback runs, and the proposal stays open
  with its approvals.
- `execute` of a hide: the same caller and approval rules, with `note_id`
  and `salt_hex` and no `receiver` or `amount_yocto`.
  `multisig_commitment(current account, proposal_id, HideNote { note_id },
  salt)` equals the stored commitment, and `set_notes_contract` named a
  notes contract. The contract marks the proposal `executed` and calls
  `hide_note({"note_id", "proposal_id"})` on the notes contract with 10
  Tgas. If that call fails (for example, the note is hidden already), the
  callback sets the proposal to `open` again. Admin B's `execute` with 50
  Tgas burns about 6.6 Tgas in all (sandbox).
- `set_notes_contract`: only the contract account can call it. The notes
  contract must name this contract as its moderator. The account is kept
  outside the contract state, and so is the note id of each executed hide,
  so an upgrade of the deployed contract (without hides) needs no state
  migration. The sandbox test checks this upgrade from the code that is
  deployed on testnet.

A verdict is valid when all of these are true, in this order. The check is
`check_verdict_with` of `seams-voice-verdict` (`crates/voice-verdict`), with
the host's `ed25519_verify`; a failed check panics with the text of its
`Refusal`.

1. `signature_b64` is standard base64 of 64 bytes, and it is the ed25519
   signature of `SHA-256("seams:outlayer:voice-verdict:v2" || verdict_json
   bytes)` by the pinned verifier key.
2. `verdict_json` is a JSON object, and its `kind` is
   `seams_voice_signed_verdict_v2`.
3. `verdict_json` has exactly the 13 verdict fields.
4. `outcome` is `accept`. A `step_up` or `refuse` verdict fails.
5. `expires_at_ms` is not before the block time.
6. `request_digest` is the base64url (no padding) text of
   `multisig_approval_digest(testnet, predecessor, current account,
   proposal_id, commitment)`. The predecessor is the proposer, so the
   verdict of another account fails.

`ProposalView`:

```json
{
  "id": 12,
  "commitment_hex": "fef5fa1f9199c0bc052ac3560dc473ffd7beab386e984439834b41b3eda3d8ee",
  "proposer": "visitor.testnet",
  "approvals": ["admin-a.seams-v1.testnet", "admin-b.seams-v1.testnet"],
  "status": "executed",
  "created_at_ms": 1794300000000,
  "receiver": "seams-grants.testnet",
  "amount_yocto": "10000000000000000000000"
}
```

The example is proposal 12 of `multisig.seams-v1.testnet`: 0.01 NEAR to
`seams-grants.testnet`, with a salt of 32 `0x5a` bytes.

`status` is `open` or `executed`. `approvals` lists each admin in the order
they approved. `created_at_ms` is the block time of `propose`. `receiver`
and `amount_yocto` are absent until a transfer arrives. While a transfer is
in flight (one or two blocks), the status is `executed` and the two fields
are still absent. `note_id` is absent until a hide succeeds, in the same
way. A proposal has at most one of the two: `receiver` and `amount_yocto`,
or `note_id`.

`get_proposals`: `from_index` 0 (the default) is the newest proposal.
`limit` is at most 50 (the default); a larger limit gives 50.

## Events

Each change logs one NEP-297 event, standard `voice_multisig`, version
`2.1.0`. `execute` itself logs nothing; its callback logs `executed` or
`execute_failed`. Version 2.1.0 adds the `executed` event of a hide,
`{"proposal_id", "note_id"}`; the other events are the same as in 2.0.0.

```text
EVENT_JSON:{"standard":"voice_multisig","version":"2.1.0","event":"proposed","data":[{"proposal_id":12,"commitment_hex":"fef5…d8ee","proposer":"visitor.testnet"}]}
EVENT_JSON:{"standard":"voice_multisig","version":"2.1.0","event":"approved","data":[{"proposal_id":12,"admin":"admin-a.seams-v1.testnet","approvals":1}]}
EVENT_JSON:{"standard":"voice_multisig","version":"2.1.0","event":"approved","data":[{"proposal_id":12,"admin":"admin-b.seams-v1.testnet","approvals":2}]}
EVENT_JSON:{"standard":"voice_multisig","version":"2.1.0","event":"executed","data":[{"proposal_id":12,"receiver":"seams-grants.testnet","amount_yocto":"10000000000000000000000"}]}
EVENT_JSON:{"standard":"voice_multisig","version":"2.1.0","event":"execute_failed","data":[{"proposal_id":12}]}
```

## Failure messages

The rows of each method are in the order that the contract checks them.
near-sdk checks the deposit, the private method and the second `new` before
the contract's own checks.

| Message | Method |
| ------- | ------ |
| `admins must have 1 to 10 accounts` | `new` |
| `admins must be distinct` | `new` |
| `verifier_public_key must be ed25519:<base58 of 32 bytes>` | `new` |
| `Method new is private` | `new` |
| `The contract has already been initialized` | `new` |
| `an admin cannot propose` | `propose` |
| `proposal_id must be next_proposal_id, <n>` | `propose` |
| `commitment_hex must be 64 lowercase hex characters` | `propose` |
| `signature_b64 must be standard base64 of 64 bytes` | `propose` |
| `the verdict signature does not match the verifier key` | `propose` |
| `verdict_json is not a verdict: <serde error>` | `propose` |
| `the verdict kind must be seams_voice_signed_verdict_v2` | `propose` |
| `the verdict outcome must be accept` | `propose` |
| `the verdict has expired` | `propose` |
| `the verdict is for another request` | `propose` |
| `the caller is not an admin` | `approve` |
| `no proposal has this id` | `approve`, `execute` |
| `the proposal is already executed` | `approve`, `execute` |
| `this admin already approved the proposal` | `approve` |
| `only the proposer or an admin can execute the proposal` | `execute` |
| `the proposal has <n> of <total> admin approvals` | `execute` |
| `receiver must be a named account that the grammar can speak` | `execute` |
| `amount_yocto must be a multiple of 0.01 NEAR from 0.01 to 1,000,000 NEAR` | `execute` |
| `salt_hex must be 64 lowercase hex characters` | `execute` |
| `receiver, amount_yocto and salt_hex do not match the commitment` | `execute` |
| `Exceeded the account balance.` (the runtime, at the transfer) | `execute` |
| `Method <name> doesn't accept deposit` | `propose`, `approve`, `execute` |
| `Method on_transfer is private` | `on_transfer` |

## Gas and storage

Measured in the nearcore 2.14.0 sandbox (`sandbox/tests/sandbox.rs`), 30 Tgas
attached, 2 admins, on 2026-11-11 with the shared verdict check
(`crates/voice-verdict`). The `execute` rows are the total of the call, the
transfer and the callback. The shared check made the WASM 9.4 KB larger and
`propose` 0.06 Tgas more expensive than the old copy of the check.

| Call                                | Gas burnt |
| ----------------------------------- | --------- |
| `new`                               | 1.70 Tgas |
| `propose`                           | 2.37 Tgas |
| `approve`, the first of 2           | 1.93 Tgas |
| `approve`, the second of 2          | 1.93 Tgas |
| `execute`, the transfer arrives     | 4.92 Tgas |
| `execute`, the transfer fails       | 5.12 Tgas |

The three admin calls of one proposal (2 `approve` and 1 `execute`) burn
about 8.8 Tgas in total.

One proposal with 2 admin approvals uses 158 bytes of contract storage
(with `admin-a.test.near`-length accounts; 0.0016 NEAR at 10^19 yoctoNEAR a
byte). The contract code uses about 2.55 NEAR (255,182 bytes). The contract balance pays for
all storage and for the transfers.

## Build and test

### Reproducible build

This build gives the WASM to deploy. It gives the same bytes on any computer
(see [`../README.md`](../README.md#reproducible-build)). It needs Docker,
git and cargo-near 0.22.0.

```bash
../reproducible.sh build voice-multisig   # writes res/voice_multisig.wasm and reproducible.sha256
../reproducible.sh check voice-multisig   # builds the recorded commit again and compares
```

The build of 11 Nov 2026 gave:

| Item               | Value |
| ------------------ | ----- |
| Commit             | `777b84429096604e77e217480e9f89a398f5da13` |
| Size               | 210,878 bytes |
| SHA-256            | `95208e2a2b5091c677ad0e521fea43f7bc74d5a661981553b8ed5d835110e644` |
| Code hash (base58) | `B38YGRGymzWML2WoNz2TLqLe5z1vmKc1wjcHYRCEUahh` |

`reproducible.sha256` holds the same commit and SHA-256.

The deployed code is this build, since the redeploy of 2026-11-11 (see
"Deploy to testnet"). SourceScan built the commit again and got the same code
hash, so NearBlocks shows the code as verified: the "Contract" tab of
<https://testnet.nearblocks.io/address/multisig.seams-v1.testnet>.

### Local build

```bash
./build.sh
```

The script builds `res/voice_multisig.wasm` with the local toolchain. It is
fast, and the sandbox test uses it. Its bytes depend on the computer, because
the WASM holds the local source paths of panic locations. The build of 10 Nov
2026 without the cap gave 230,376 bytes, SHA-256
`c3f420b83a4bdffc56ba1cb0a059414192480158040d30315f8ec6594210e037`.

### Tests

```bash
cargo test -p voice-multisig
```

The 57 unit tests sign real verdicts with a test ed25519 key. They cover
each rule of `new`, `propose`, `approve` and `execute`, the amount range of
the grammar (1,000,000 NEAR passes, 1,000,000.01 NEAR fails), and the
failed transfer that opens the proposal again. One test checks the
verifier's shared vector (`crates/voice-verifier/testdata/signed_verdict_v2.json`):
its signature passes, and the contract refuses it as a transfer verdict.

```bash
./build.sh && cargo test -p voice-multisig-sandbox -- --nocapture
```

The sandbox test deploys the contract with 2 admins and 10 NEAR and runs
three proposals: one whose 0.01 NEAR arrives at the receiver, one whose
receiver does not exist, so the callback opens it again, and one of 12 NEAR,
above the balance, so `execute` fails and the proposal stays open. It also
checks these failures on the real runtime: an admin that proposes, a wrong
signature, an expired verdict, the verdict of another account, an approval
by the proposer, a second approval, an execute before all approvals, an
execute by a stranger, a wrong salt, deposits and the private methods.

## Deploy to testnet

`multisig.seams-v1.testnet` is deployed since 2026-11-10 (deploy and `new`
tx `BcBCruDvJ5MCyDPxRKqm7BCCXgUuyr1NfmeFXXZg6Dwz`, code `c3f420b8…e037`), with about 10.5 NEAR.
On 2026-11-11 it got the code of `dev` 01dde86, with the hide of a note and the shared
verdict check (255,550 bytes, SHA-256 `dc86875e…1531` in that build folder), with no init call:
tx `DfXs4nJpJTMgiK5RnvfwAWdzEwiF6BnkokXGkY7J4rSk`. `set_notes_contract` to `notes.seams-v1.testnet`:
tx `A3zL4SZ4iDXXLAzpYZNzZf8n3VqsFbEBTzR9Qk2mfDMu`. The config and the admins stayed.
Later on 2026-11-11 it got the reproducible build of commit `777b844` (210,878 bytes, SHA-256
`95208e2a…e644`, code hash `B38YGRGymzWML2WoNz2TLqLe5z1vmKc1wjcHYRCEUahh`), with the same contract
source as 01dde86 and no init call: tx `Exeu3mx8x1VZdheteCWAVvduEZo3H6FSeNLqsfusDD7t`. The config,
the admins and the notes contract stayed. The steps below are
the record and the way to deploy again. Each step waits for the owner's
go-ahead. The first deploy, `team.seams-v1.testnet` (2026-11-10,
code `d82479ab…e327`), had a cap of 0.05 NEAR. It stays on chain, and
`multisig.seams-v1.testnet` replaces it in the demo.

The verifier key is `ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U`.
It is the verdict key of the OutLayer project
`seams-v1.testnet/voice-verifier` for runs that the Seams payment key pays
for, and it stays the same across versions. The keystore derives the key
from the project and the payment-key owner. If `/api/voice-verify` uses
another payment key, read `public_key` from a `verify` output of that route
and put that key in `new`.

1. Create the two admin accounts, with 1 NEAR each for gas. They exist
   since 2026-11-10, so skip this step for them:

   ```bash
   near account create-account fund-myself admin-a.seams-v1.testnet '1 NEAR' autogenerate-new-keypair save-to-legacy-keychain sign-as seams-v1.testnet network-config testnet sign-with-legacy-keychain send
   ```

   ```bash
   near account create-account fund-myself admin-b.seams-v1.testnet '1 NEAR' autogenerate-new-keypair save-to-legacy-keychain sign-as seams-v1.testnet network-config testnet sign-with-legacy-keychain send
   ```

2. Create the contract account. 3 NEAR covers the code (about 2.55 NEAR):

   ```bash
   near account create-account fund-myself multisig.seams-v1.testnet '3 NEAR' autogenerate-new-keypair save-to-legacy-keychain sign-as seams-v1.testnet network-config testnet sign-with-legacy-keychain send
   ```

3. Deploy the WASM of the reproducible build (`../reproducible.sh build
   voice-multisig`) with the two admins and the verifier key:

   ```bash
   near contract deploy multisig.seams-v1.testnet use-file res/voice_multisig.wasm with-init-call new json-args '{"admins":["admin-a.seams-v1.testnet","admin-b.seams-v1.testnet"],"verifier_public_key":"ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U"}' prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-legacy-keychain send
   ```

4. Fund the multisig with a plain transfer, to 10 NEAR in total. With no
   cap, the balance is the most that one proposal can move:

   ```bash
   near tokens seams-v1.testnet send-near multisig.seams-v1.testnet '7 NEAR' network-config testnet sign-with-legacy-keychain send
   ```

5. Give each admin a function-call key for `approve` and `execute` on the
   contract only. A function-call key names one contract, so the keys for
   `team.seams-v1.testnet` do not work here. The approve route signs with
   these keys: put them in the Pages secrets `MULTISIG_ADMIN_A_KEY` and
   `MULTISIG_ADMIN_B_KEY`, and deploy the page again:

   ```bash
   near account add-key admin-a.seams-v1.testnet grant-function-call-access --allowance '1 NEAR' --contract-account-id multisig.seams-v1.testnet --function-names 'approve, execute' autogenerate-new-keypair save-to-legacy-keychain network-config testnet sign-with-legacy-keychain send
   ```

   ```bash
   near account add-key admin-b.seams-v1.testnet grant-function-call-access --allowance '1 NEAR' --contract-account-id multisig.seams-v1.testnet --function-names 'approve, execute' autogenerate-new-keypair save-to-legacy-keychain network-config testnet sign-with-legacy-keychain send
   ```

6. Read the config and the proposals:

   ```bash
   near contract call-function as-read-only multisig.seams-v1.testnet get_config json-args '{}' network-config testnet now
   ```

   ```bash
   near contract call-function as-read-only multisig.seams-v1.testnet get_proposals json-args '{"from_index":0,"limit":50}' network-config testnet now
   ```
