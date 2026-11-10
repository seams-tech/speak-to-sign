# Voice multisig contract

A NEAR multisig for the voice multisig demo (`demo/frontend`, `/multisig/`).
Any account that is not an admin proposes a transfer with its own spoken
approval. It reads the transfer aloud, and the verifier checks the voice and
the words and signs a verdict. This contract checks the verdict on chain.
Then each admin approves the proposal with a plain signed call, and the
proposer or an admin executes it. The chain holds only a salted hash of the
transfer, the commitment, until `execute`. Each transfer is at most the cap
that `new` sets. Testnet only.

The plan is in `docs/voice-multisig-guests.md`. The threat table of the
first design, with voice members, is in `docs/voice-multisig.md`.

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
| `new`              | init     | `{"admins": AccountId[], "verifier_public_key": "ed25519:<base58>", "max_amount_yocto": U128}` | — |
| `propose`          | change   | `{"proposal_id": u64, "commitment_hex": String, "verdict_json": String, "signature_b64": String}` | `u64`, the proposal id |
| `approve`          | change   | `{"proposal_id": u64}` | `u32`, the number of admin approvals |
| `execute`          | change   | `{"proposal_id": u64, "receiver": AccountId, "amount_yocto": U128, "salt_hex": String}` | `bool`: `true` if the transfer arrived, `false` if it failed |
| `on_transfer`      | callback | private | `bool` |
| `get_proposal`     | view     | `{"proposal_id": u64}` | `ProposalView` or `null` |
| `get_proposals`    | view     | `{"from_index"?: u64, "limit"?: u32}` | `ProposalView[]`, newest first |
| `get_config`       | view     | `{}` | `{"admins", "verifier_public_key", "max_amount_yocto"}` |
| `next_proposal_id` | view     | `{}` | `u64`, starts at 1 |

Rules:

- `new`: only the contract account can call it, in the deploy transaction.
  1 to 10 distinct admins. The verifier key is `ed25519:` and the base58
  text of 32 bytes. `max_amount_yocto` is a multiple of 0.01 NEAR, at least
  0.01 NEAR.
- `propose`: the caller is any account that is not an admin, and it becomes
  the proposer. An admin approves by key, so it cannot also be the voice
  that proposes. `proposal_id` equals `next_proposal_id`. `commitment_hex`
  is 64 lowercase hex characters. The verdict is valid for the caller and
  this commitment (see below). The proposal starts with no approvals.
- `approve`: the caller is an admin who did not approve yet. The proposal is
  open. The call has no verdict.
- `execute`: the proposal is open. The caller is the proposer or an admin.
  All admins approved. `amount_yocto` is at most `max_amount_yocto`.
  `receiver` is a named account that the grammar can speak (not implicit,
  not `0x`). `amount_yocto` is a multiple of 0.01 NEAR from 0.01 to
  1,000,000 NEAR. `salt_hex` is 64 lowercase hex characters.
  `multisig_commitment(current account, proposal_id, Transfer { receiver,
  amount }, salt)` equals the stored commitment. The contract marks the
  proposal `executed` and sends the NEAR. If the transfer fails, the NEAR
  comes back and the callback sets the proposal to `open` again. The
  approvals stay, so the proposer or an admin can execute it again.

A verdict is valid when all of these are true, in this order:

1. `signature_b64` is standard base64 of 64 bytes, and it is the ed25519
   signature of `SHA-256("seams:outlayer:voice-verdict:v2" || verdict_json
   bytes)` by the pinned verifier key.
2. `verdict_json` is a JSON object with exactly the 13 verdict fields.
3. `kind` is `seams_voice_signed_verdict_v2`.
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
  "commitment_hex": "2d15b47763a416b7a7960a53d07d1bbd91474be75f42de257276378213f425fc",
  "proposer": "visitor.testnet",
  "approvals": ["admin-a.seams-v1.testnet", "admin-b.seams-v1.testnet"],
  "status": "executed",
  "created_at_ms": 1794300000000,
  "receiver": "seams-grants.testnet",
  "amount_yocto": "10000000000000000000000"
}
```

The example is proposal 12 of `team.seams-v1.testnet`: 0.01 NEAR to
`seams-grants.testnet`, with a salt of 32 `0x5a` bytes.

`status` is `open` or `executed`. `approvals` lists each admin in the order
they approved. `created_at_ms` is the block time of `propose`. `receiver`
and `amount_yocto` are absent until a transfer arrives. While a transfer is
in flight (one or two blocks), the status is `executed` and the two fields
are still absent.

`get_proposals`: `from_index` 0 (the default) is the newest proposal.
`limit` is at most 50 (the default); a larger limit gives 50.

## Events

Each change logs one NEP-297 event, standard `voice_multisig`, version
`2.0.0`. `execute` itself logs nothing; its callback logs `executed` or
`execute_failed`.

```text
EVENT_JSON:{"standard":"voice_multisig","version":"2.0.0","event":"proposed","data":[{"proposal_id":12,"commitment_hex":"2d15…25fc","proposer":"visitor.testnet"}]}
EVENT_JSON:{"standard":"voice_multisig","version":"2.0.0","event":"approved","data":[{"proposal_id":12,"admin":"admin-a.seams-v1.testnet","approvals":1}]}
EVENT_JSON:{"standard":"voice_multisig","version":"2.0.0","event":"approved","data":[{"proposal_id":12,"admin":"admin-b.seams-v1.testnet","approvals":2}]}
EVENT_JSON:{"standard":"voice_multisig","version":"2.0.0","event":"executed","data":[{"proposal_id":12,"receiver":"seams-grants.testnet","amount_yocto":"10000000000000000000000"}]}
EVENT_JSON:{"standard":"voice_multisig","version":"2.0.0","event":"execute_failed","data":[{"proposal_id":12}]}
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
| `max_amount_yocto must be a multiple of 0.01 NEAR, at least 0.01 NEAR` | `new` |
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
| `amount_yocto is above max_amount_yocto` | `execute` |
| `receiver must be a named account that the grammar can speak` | `execute` |
| `amount_yocto must be a multiple of 0.01 NEAR from 0.01 to 1,000,000 NEAR` | `execute` |
| `salt_hex must be 64 lowercase hex characters` | `execute` |
| `receiver, amount_yocto and salt_hex do not match the commitment` | `execute` |
| `Method <name> doesn't accept deposit` | `propose`, `approve`, `execute` |
| `Method on_transfer is private` | `on_transfer` |

## Gas and storage

Measured in the nearcore 2.14.0 sandbox (`sandbox/tests/sandbox.rs`), 30 Tgas
attached, 2 admins. The `execute` rows are the total of the call, the
transfer and the callback.

| Call                                | Gas burnt |
| ----------------------------------- | --------- |
| `new`                               | 1.67 Tgas |
| `propose`                           | 2.29 Tgas |
| `approve`, the first of 2           | 1.90 Tgas |
| `approve`, the second of 2          | 1.91 Tgas |
| `execute`, the transfer arrives     | 4.87 Tgas |
| `execute`, the transfer fails       | 5.07 Tgas |

The three admin calls of one proposal (2 `approve` and 1 `execute`) burn
about 8.7 Tgas in total.

One proposal with 2 admin approvals uses 158 bytes of contract storage
(with `admin-a.test.near`-length accounts; 0.0016 NEAR at 10^19 yoctoNEAR a
byte). The contract code uses about 2.32 NEAR. The contract balance pays for
all storage and for the transfers.

## Build and test

```bash
./build.sh
```

The build of 10 Nov 2026 gave `res/voice_multisig.wasm`, 231,858 bytes,
SHA-256 `d82479ab988c5f89707274289e08716d71f76bd60f599b4ef58e47af4a55e327`.
The WASM holds the source paths of panic locations, so a build in another
home folder gives another hash.

```bash
cargo test -p voice-multisig
```

The 60 unit tests sign real verdicts with a test ed25519 key. They cover
each rule of `new`, `propose`, `approve` and `execute`, the cap, and the
failed transfer that opens the proposal again. One test checks the
verifier's shared vector (`crates/voice-verifier/testdata/signed_verdict_v2.json`):
its signature passes, and the contract refuses it as a transfer verdict.

```bash
./build.sh && cargo test -p voice-multisig-sandbox -- --nocapture
```

The sandbox test deploys the contract with 2 admins and runs two proposals:
one whose 0.01 NEAR arrives at the receiver, and one whose receiver does not
exist, so the callback opens it again. It also checks these failures on the
real runtime: an admin that proposes, a wrong signature, an expired verdict,
the verdict of another account, an approval by the proposer, a second
approval, an execute before all approvals, an execute by a stranger, a
wrong salt, an amount above the cap, deposits and the private methods.

## Deploy to testnet

Not deployed. Each step waits for the owner's go-ahead.

The verifier key is `ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U`.
It is the verdict key of the OutLayer project
`seams-v1.testnet/voice-verifier` for runs that the Seams payment key pays
for, and it stays the same across versions. The keystore derives the key
from the project and the payment-key owner. If `/api/voice-verify` uses
another payment key, read `public_key` from a `verify` output of that route
and put that key in `new`.

1. Create the two admin accounts, with 1 NEAR each for gas:

   ```bash
   near account create-account fund-myself admin-a.seams-v1.testnet '1 NEAR' autogenerate-new-keypair save-to-legacy-keychain sign-as seams-v1.testnet network-config testnet sign-with-legacy-keychain send
   ```

   ```bash
   near account create-account fund-myself admin-b.seams-v1.testnet '1 NEAR' autogenerate-new-keypair save-to-legacy-keychain sign-as seams-v1.testnet network-config testnet sign-with-legacy-keychain send
   ```

2. Create the contract account. 3 NEAR covers the code (about 2.32 NEAR):

   ```bash
   near account create-account fund-myself team.seams-v1.testnet '3 NEAR' autogenerate-new-keypair save-to-legacy-keychain sign-as seams-v1.testnet network-config testnet sign-with-legacy-keychain send
   ```

3. Deploy the contract with the two admins, the verifier key and a cap of
   0.05 NEAR:

   ```bash
   near contract deploy team.seams-v1.testnet use-file res/voice_multisig.wasm with-init-call new json-args '{"admins":["admin-a.seams-v1.testnet","admin-b.seams-v1.testnet"],"verifier_public_key":"ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U","max_amount_yocto":"50000000000000000000000"}' prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-legacy-keychain send
   ```

4. Fund the multisig with a plain transfer, to 10 NEAR in total:

   ```bash
   near tokens seams-v1.testnet send-near team.seams-v1.testnet '7 NEAR' network-config testnet sign-with-legacy-keychain send
   ```

5. Give each admin a function-call key for `approve` and `execute` on the
   contract only. The approve route signs with these keys
   (`MULTISIG_ADMIN_A_KEY` and `MULTISIG_ADMIN_B_KEY`):

   ```bash
   near account add-key admin-a.seams-v1.testnet grant-function-call-access --allowance '1 NEAR' --contract-account-id team.seams-v1.testnet --function-names 'approve, execute' autogenerate-new-keypair save-to-legacy-keychain network-config testnet sign-with-legacy-keychain send
   ```

   ```bash
   near account add-key admin-b.seams-v1.testnet grant-function-call-access --allowance '1 NEAR' --contract-account-id team.seams-v1.testnet --function-names 'approve, execute' autogenerate-new-keypair save-to-legacy-keychain network-config testnet sign-with-legacy-keychain send
   ```

6. Read the config and the queue:

   ```bash
   near contract call-function as-read-only team.seams-v1.testnet get_config json-args '{}' network-config testnet now
   ```

   ```bash
   near contract call-function as-read-only team.seams-v1.testnet get_proposals json-args '{"from_index":0,"limit":50}' network-config testnet now
   ```
