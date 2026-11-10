# Voice multisig contract

A NEAR multisig for the voice multisig demo (`demo/frontend`, `/multisig/`).
Each confirmation is a spoken intent. The proposer reads a transfer aloud,
and each other member says it from memory. The verifier checks each voice
and the words and signs a verdict. This contract checks each verdict on
chain. The chain holds only a salted hash of the transfer, the commitment,
until a member who confirmed executes it. Testnet only.

The plan and the threat table are in `docs/voice-multisig.md`.

## Toolchain

The same as `../merge-approvals/`: Rust 1.97.0 (`rust-toolchain.toml`),
near-sdk 5.30.1, near-workspaces 0.24.0 with the nearcore 2.14.0 sandbox.
`.cargo/config.toml` adds `--cfg near` to each WASM build, so a failed call
keeps its message on chain. The contract links `crates/spoken-intent` by
path for the commitment and the request digest.

## Interface

Members are `predecessor_account_id`. Ids are JSON numbers. Amounts are
yoctoNEAR as decimal strings (`U128`). No change method accepts a deposit:
a call with a deposit fails. The multisig gets its NEAR by a plain transfer
to its account.

| Method             | Kind     | Arguments | Returns |
| ------------------ | -------- | --------- | ------- |
| `new`              | init     | `{"members": AccountId[], "threshold": u8, "verifier_public_key": "ed25519:<base58>"}` | — |
| `propose`          | change   | `{"proposal_id": u64, "commitment_hex": String, "verdict_json": String, "signature_b64": String}` | `u64`, the proposal id |
| `confirm`          | change   | `{"proposal_id": u64, "verdict_json": String, "signature_b64": String}` | `u32`, the number of confirmations |
| `execute`          | change   | `{"proposal_id": u64, "receiver": AccountId, "amount_yocto": U128, "salt_hex": String}` | `bool`: `true` if the transfer arrived, `false` if it failed |
| `on_transfer`      | callback | private | `bool` |
| `get_proposal`     | view     | `{"proposal_id": u64}` | `ProposalView` or `null` |
| `get_proposals`    | view     | `{"from_index"?: u64, "limit"?: u32}` | `ProposalView[]`, newest first |
| `get_config`       | view     | `{}` | `{"members", "threshold", "verifier_public_key"}` |
| `next_proposal_id` | view     | `{}` | `u64`, starts at 1 |

Rules:

- `new`: only the contract account can call it, in the deploy transaction.
  2 to 10 distinct members. The threshold is 1 to the member count. The
  verifier key is `ed25519:` and the base58 text of 32 bytes.
- `propose`: the caller is a member. `proposal_id` equals
  `next_proposal_id`. `commitment_hex` is 64 lowercase hex characters. The
  verdict is valid for this commitment (see below). The proposer is the
  first confirmation.
- `confirm`: the caller is a member who did not confirm yet. The proposal is
  open. The verdict is valid for the stored commitment.
- `execute`: the caller is a member who confirmed. The proposal is open and
  has at least `threshold` confirmations. `receiver` is a named account that
  the grammar can speak (not implicit, not `0x`). `amount_yocto` is a
  multiple of 0.01 NEAR from 0.01 to 1,000,000 NEAR. `salt_hex` is 64
  lowercase hex characters. `multisig_commitment(current account,
  proposal_id, Transfer { receiver, amount }, salt)` equals the stored
  commitment. The contract marks the proposal `executed` and sends the NEAR.
  If the transfer fails, the NEAR comes back and the callback sets the
  proposal to `open` again, so a member can execute it again.

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
   proposal_id, commitment)`.

`ProposalView`:

```json
{
  "id": 1,
  "commitment_hex": "e107e77c5aa75b1d6e487fdec2a8738fac6a8ecaa4ae13d68267f4f2816c593f",
  "proposer": "alice.testnet",
  "confirmations": ["alice.testnet", "bob.testnet"],
  "status": "executed",
  "receiver": "grants.testnet",
  "amount_yocto": "25000000000000000000000000"
}
```

`status` is `open` or `executed`. `receiver` and `amount_yocto` are absent
until a transfer arrives. While a transfer is in flight (one or two blocks),
the status is `executed` and the two fields are still absent.

`get_proposals`: `from_index` 0 (the default) is the newest proposal.
`limit` is at most 50 (the default); a larger limit gives 50.

## Events

Each change logs one NEP-297 event, standard `voice_multisig`, version
`1.0.0`. `execute` itself logs nothing; its callback logs `executed` or
`execute_failed`.

```text
EVENT_JSON:{"standard":"voice_multisig","version":"1.0.0","event":"proposed","data":[{"proposal_id":1,"commitment_hex":"e107…593f","proposer":"alice.testnet"}]}
EVENT_JSON:{"standard":"voice_multisig","version":"1.0.0","event":"confirmed","data":[{"proposal_id":1,"member":"bob.testnet","confirmations":2}]}
EVENT_JSON:{"standard":"voice_multisig","version":"1.0.0","event":"executed","data":[{"proposal_id":1,"receiver":"grants.testnet","amount_yocto":"25000000000000000000000000"}]}
EVENT_JSON:{"standard":"voice_multisig","version":"1.0.0","event":"execute_failed","data":[{"proposal_id":1}]}
```

## Failure messages

| Message | Method |
| ------- | ------ |
| `members must have 2 to 10 accounts` | `new` |
| `members must be distinct` | `new` |
| `threshold must be 1 to the number of members` | `new` |
| `verifier_public_key must be ed25519:<base58 of 32 bytes>` | `new` |
| `Method new is private` | `new` |
| `The contract has already been initialized` | `new` |
| `the caller is not a member` | `propose`, `confirm`, `execute` |
| `proposal_id must be next_proposal_id, <n>` | `propose` |
| `commitment_hex must be 64 lowercase hex characters` | `propose` |
| `no proposal has this id` | `confirm`, `execute` |
| `the proposal is already executed` | `confirm`, `execute` |
| `this member already confirmed the proposal` | `confirm` |
| `signature_b64 must be standard base64 of 64 bytes` | `propose`, `confirm` |
| `the verdict signature does not match the verifier key` | `propose`, `confirm` |
| `verdict_json is not a verdict: <serde error>` | `propose`, `confirm` |
| `the verdict kind must be seams_voice_signed_verdict_v2` | `propose`, `confirm` |
| `the verdict outcome must be accept` | `propose`, `confirm` |
| `the verdict has expired` | `propose`, `confirm` |
| `the verdict is for another request` | `propose`, `confirm` |
| `only a member who confirmed the proposal can execute it` | `execute` |
| `the proposal has <n> of <threshold> confirmations` | `execute` |
| `receiver must be a named account that the grammar can speak` | `execute` |
| `amount_yocto must be a multiple of 0.01 NEAR from 0.01 to 1,000,000 NEAR` | `execute` |
| `salt_hex must be 64 lowercase hex characters` | `execute` |
| `receiver, amount_yocto and salt_hex do not match the commitment` | `execute` |
| `Method <name> doesn't accept deposit` | `propose`, `confirm`, `execute` |
| `Method on_transfer is private` | `on_transfer` |

## Gas and storage

Measured in the nearcore 2.14.0 sandbox (`sandbox/tests/sandbox.rs`), 30 Tgas
attached, 3 members, threshold 2. The `execute` rows are the total of the
call, the transfer and the callback.

| Call                                | Gas burnt |
| ----------------------------------- | --------- |
| `new`                               | 1.67 Tgas |
| `propose`                           | 2.30 Tgas |
| `confirm`                           | 2.29 Tgas |
| `execute`, the transfer arrives     | 4.88 Tgas |
| `execute`, the transfer fails       | 5.07 Tgas |

One proposal with 2 confirmations uses 142 bytes of contract storage (with
`alice.test.near`-length accounts; 0.0014 NEAR at 10^19 yoctoNEAR a byte).
The contract code uses about 2.34 NEAR. The contract balance pays for all
storage and for the transfers.

## Build and test

```bash
./build.sh
```

The build of 10 Nov 2026 gave `res/voice_multisig.wasm`, 233,719 bytes,
SHA-256 `b5bd4ffdd0d28dd66853223adf2f82c54d227cd5da852f2c995bf7a53716c4a6`.
The WASM holds the source paths of panic locations, so a build in another
home folder gives another hash.

```bash
cargo test -p voice-multisig
```

The unit tests sign real verdicts with a test ed25519 key. One test checks
the verifier's shared vector (`crates/voice-verifier/testdata/signed_verdict_v2.json`):
its signature passes, and the contract refuses it as a transfer verdict.

```bash
./build.sh && cargo test -p voice-multisig-sandbox -- --nocapture
```

The sandbox test runs two proposals: one whose 25 NEAR arrives at the
receiver, and one whose receiver does not exist, so the callback opens it
again. It also checks the deposit, signature, expiry and private-method
failures on the real runtime.

## Deploy to testnet

Not deployed. Each step waits for the owner's go-ahead.

The verifier key must be the key that signs the demo's verdicts. The
keystore derives it from the OutLayer project and the payment-key owner, so
the demo's own payment key can give a key other than the Seams key
`ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U`. Read
`public_key` from a `verify` output that the demo route returns, and put it
in `new`.

```bash
near account create-account fund-myself team.seams-v1.testnet '5 NEAR' autogenerate-new-keypair save-to-legacy-keychain sign-as seams-v1.testnet network-config testnet sign-with-legacy-keychain send
```

```bash
near contract deploy team.seams-v1.testnet use-file res/voice_multisig.wasm with-init-call new json-args '{"members":["<member 1>","<member 2>","<member 3>"],"threshold":2,"verifier_public_key":"ed25519:<demo verifier key>"}' prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-legacy-keychain send
```

Fund the multisig with a plain transfer:

```bash
near tokens seams-v1.testnet send-near team.seams-v1.testnet '10 NEAR' network-config testnet sign-with-legacy-keychain send
```

```bash
near contract call-function as-read-only team.seams-v1.testnet get_config json-args '{}' network-config testnet now
```

```bash
near contract call-function as-read-only team.seams-v1.testnet get_proposals json-args '{"from_index":0,"limit":50}' network-config testnet now
```
