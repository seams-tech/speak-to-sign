# Voice multisig contract

A voice-only NEAR multisig. It has a fixed set of signers and a threshold
M of N, and no admin. A signer is a NEAR account with an enrolled voice. A
signer proposes a transfer, or "hide note N" for a harmful community note,
and reads the proposal aloud. The verifier checks the voice and the words
and signs a verdict. This contract checks the verdict on chain. The
proposer's verdict is the first approval. Each other signer says the same
proposal from memory, and approves with a verdict of its own. When M
signers approved, a signer executes the proposal. No call without a verdict
can approve.

The chain holds only a salted hash of the proposal, the commitment, until
`execute`. For a hide, this contract is the moderator of the notes contract
(`../community-notes/`) that `set_notes_contract` names, and `execute`
calls its `hide_note`. The contract has no cap: a transfer is any amount
that the grammar can speak (0.01 to 1,000,000 NEAR), and the balance of the
multisig limits it. Testnet only.

This README is for version 3.0.0, the source in `src/`. Version 3.0.0 is on
`voice-multisig.seams-v1.testnet` since 2026-11-12, with 2 of 2 signers
(see "Deployed code"). No demo page uses it yet. The older account
`multisig.seams-v1.testnet` (version 2.x, with two admins that approved by
plain calls) was deleted on 2026-11-12 (see "Deployed code").

The specification is in `docs/voice-intents-spec.md`, section 10. The
sequence diagram is in `docs/architecture.md`, section 7.

## Design

- **Signers and threshold.** `new` sets 1 to 10 distinct signers and a
  threshold from 1 to the number of signers. No method changes them later.
  A change of the signers needs a new contract account. A voice-approved
  proposal that changes the signers does not exist yet.
- **Propose.** The caller is a signer. The verdict is for the caller, this
  contract, the proposal id and the commitment. It is the first approval.
- **Approve.** The caller is a signer who did not approve yet. The verdict
  is for the caller and the stored commitment of this proposal. The
  verifier signs it for `multisig_confirm`: the signer says the proposal
  from memory, and the verifier loads the proposal by the commitment. The
  contract checks the key, the outcome, the expiry, the owner (the caller)
  and the commitment, as `propose` does.
- **How a signer knows the proposal.** The chain and the verifier never
  show the proposal to another signer: the chain holds only the salted
  hash, and the verifier keeps the proposal encrypted in its storage. So
  the proposer tells the other signers the proposal off chain, for example
  in a call or a team chat, as for each multisig. Each signer then says it
  aloud. The verifier accepts only the words of the stored proposal, gives
  no hint on a refusal, and stops after 3 wrong tries. So a signer approves
  only the proposal that it said, and the words on a changed page do not
  pass.
- **One recording counts once.** The contract keeps the `audio_digest` of
  each verdict that counted. A verdict with an audio digest that counted
  before fails, in `propose` and in `approve`, for each proposal. So the
  same verdict or the same recording cannot count twice. The verifier
  already passes each recording one time (`audio:v2:<digest>` in its
  storage); this check holds on chain too. The verifier adds two more
  rules: a verdict expires 120 s after the verifier signs it, and a voice
  that matches another signer who said the proposal is refused
  (`same_speaker`).
- **Execute.** The caller is a signer. The proposal has at least
  `threshold` approvals. The call has no verdict: it only opens what the
  signers approved, and the opening must match the commitment.
- **No plain-call path.** No method approves without a verdict, executes a
  proposal below the threshold, or changes the signers or the threshold.
  `set_notes_contract` is private (only the contract account calls it),
  and it does not approve or execute.

The full-access key of the contract account can deploy new code. That is a
trust limit of each NEAR contract. For real funds, delete that key after
`new` and `set_notes_contract`. The testnet demo keeps it.

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
| `new`              | init     | `{"signers": AccountId[], "threshold": u32, "verifier_public_key": "ed25519:<base58>"}` | — |
| `propose`          | change   | `{"proposal_id": u64, "commitment_hex": String, "verdict_json": String, "signature_b64": String}` | `u64`, the proposal id |
| `approve`          | change   | `{"proposal_id": u64, "verdict_json": String, "signature_b64": String}` | `u32`, the number of approvals |
| `execute`          | change   | `{"proposal_id": u64, "receiver": AccountId, "amount_yocto": U128, "salt_hex": String}` for a transfer, or `{"proposal_id": u64, "note_id": u64, "salt_hex": String}` for a hide | `bool`: `true` if the transfer arrived or the note is hidden, `false` if it failed |
| `on_transfer`      | callback | private | `bool` |
| `on_hide`          | callback | private | `bool` |
| `set_notes_contract` | change, private | `{"account_id": AccountId}` | nothing |
| `get_notes_contract` | view   | `{}` | `AccountId` or `null` |
| `get_proposal`     | view     | `{"proposal_id": u64}` | `ProposalView` or `null` |
| `get_proposals`    | view     | `{"from_index"?: u64, "limit"?: u32}` | `ProposalView[]`, newest first |
| `get_config`       | view     | `{}` | `{"signers", "threshold", "verifier_public_key"}` |
| `next_proposal_id` | view     | `{}` | `u64`, starts at 1 |

Rules:

- `new`: only the contract account can call it, in the deploy transaction.
  1 to 10 distinct signers. `threshold` is 1 to the number of signers. The
  verifier key is `ed25519:` and the base58 text of 32 bytes.
- `propose`: the caller is a signer, and it becomes the proposer.
  `proposal_id` equals `next_proposal_id`. `commitment_hex` is 64
  lowercase hex characters. The verdict is valid for the caller and this
  commitment (see below). The proposal starts with one approval, the
  proposer's.
- `approve`: the caller is a signer. The proposal is open. The caller did
  not approve it yet (the proposer approved it with `propose`). The verdict
  is valid for the caller and the stored commitment of the proposal.
- `execute`: the caller is a signer. The proposal is open. It has at least
  `threshold` approvals.
  `receiver` is a named account that the grammar can speak (not implicit,
  not `0x`). `amount_yocto` is a multiple of 0.01 NEAR from 0.01 to
  1,000,000 NEAR. `salt_hex` is 64 lowercase hex characters.
  `multisig_commitment(current account, proposal_id, Transfer { receiver,
  amount }, salt)` equals the stored commitment. The contract marks the
  proposal `executed` and sends the NEAR. If the transfer fails, the NEAR
  comes back and the callback sets the proposal to `open` again. The
  approvals stay, so a signer can execute it again. If `amount_yocto` is
  above the balance of the multisig, the runtime refuses the transfer in
  the `execute` call itself ("Exceeded the account balance."). The call
  fails, no callback runs, and the proposal stays open with its approvals.
- `execute` of a hide: the same caller and approval rules, with `note_id`
  and `salt_hex` and no `receiver` or `amount_yocto`.
  `multisig_commitment(current account, proposal_id, HideNote { note_id },
  salt)` equals the stored commitment, and `set_notes_contract` named a
  notes contract. The contract marks the proposal `executed` and calls
  `hide_note({"note_id", "proposal_id"})` on the notes contract with 10
  Tgas. If that call fails (for example, the note is hidden already), the
  callback sets the proposal to `open` again. An `execute` of a hide with
  50 Tgas burns about 6.7 Tgas in all (sandbox).
- `set_notes_contract`: only the contract account can call it. The notes
  contract must name this contract as its moderator.

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
   proposal_id, commitment)`. The predecessor is the signer who calls, so
   the verdict of another account fails. The commitment is the argument of
   `propose`, or the stored commitment for `approve`.
7. `audio_digest` is the base64url text of 32 bytes, and no verdict with
   this audio digest counted before.

`ProposalView`:

```json
{
  "id": 1,
  "commitment_hex": "fef5fa1f9199c0bc052ac3560dc473ffd7beab386e984439834b41b3eda3d8ee",
  "proposer": "alice.testnet",
  "approvals": ["alice.testnet", "bob.testnet"],
  "status": "executed",
  "created_at_ms": 1794300000000,
  "receiver": "seams-grants.testnet",
  "amount_yocto": "10000000000000000000000"
}
```

`status` is `open` or `executed`. `approvals` lists each signer in the order
they approved; the proposer is the first. `created_at_ms` is the block time
of `propose`. `receiver` and `amount_yocto` are absent until a transfer
arrives. While a transfer is in flight (one or two blocks), the status is
`executed` and the two fields are still absent. `note_id` is absent until a
hide succeeds, in the same way. A proposal has at most one of the two:
`receiver` and `amount_yocto`, or `note_id`.

`get_proposals`: `from_index` 0 (the default) is the newest proposal.
`limit` is at most 50 (the default); a larger limit gives 50.

## Events

Each change logs one NEP-297 event, standard `voice_multisig`, version
`3.0.0`. `execute` itself logs nothing; its callback logs `executed` or
`execute_failed`. Version 3.0.0 names the approver `signer` in place of
`admin`. The other events are the same as in 2.1.0. `propose` logs only
`proposed`, which is also the first approval.

```text
EVENT_JSON:{"standard":"voice_multisig","version":"3.0.0","event":"proposed","data":[{"proposal_id":1,"commitment_hex":"fef5…d8ee","proposer":"alice.testnet"}]}
EVENT_JSON:{"standard":"voice_multisig","version":"3.0.0","event":"approved","data":[{"proposal_id":1,"signer":"bob.testnet","approvals":2}]}
EVENT_JSON:{"standard":"voice_multisig","version":"3.0.0","event":"executed","data":[{"proposal_id":1,"receiver":"seams-grants.testnet","amount_yocto":"10000000000000000000000"}]}
EVENT_JSON:{"standard":"voice_multisig","version":"3.0.0","event":"executed","data":[{"proposal_id":2,"note_id":42}]}
EVENT_JSON:{"standard":"voice_multisig","version":"3.0.0","event":"execute_failed","data":[{"proposal_id":1}]}
```

## Failure messages

The rows of each method are in the order that the contract checks them.
near-sdk checks the deposit, the private method, the JSON arguments and the
second `new` before the contract's own checks. So an `approve` with only
`{"proposal_id"}`, the plain approve of 2.x, fails with `Failed to
deserialize input from JSON` (missing field `verdict_json`).

| Message | Method |
| ------- | ------ |
| `signers must have 1 to 10 accounts` | `new` |
| `signers must be distinct` | `new` |
| `threshold must be from 1 to the number of signers` | `new` |
| `verifier_public_key must be ed25519:<base58 of 32 bytes>` | `new` |
| `Method new is private` | `new` |
| `The contract has already been initialized` | `new` |
| `the caller is not a signer` | `propose`, `approve`, `execute` |
| `proposal_id must be next_proposal_id, <n>` | `propose` |
| `commitment_hex must be 64 lowercase hex characters` | `propose` |
| `no proposal has this id` | `approve`, `execute` |
| `the proposal is already executed` | `approve`, `execute` |
| `this signer already approved the proposal` | `approve` |
| `signature_b64 must be standard base64 of 64 bytes` | `propose`, `approve` |
| `the verdict signature does not match the verifier key` | `propose`, `approve` |
| `verdict_json is not a verdict: <serde error>` | `propose`, `approve` |
| `the verdict kind must be seams_voice_signed_verdict_v2` | `propose`, `approve` |
| `the verdict outcome must be accept` | `propose`, `approve` |
| `the verdict has expired` | `propose`, `approve` |
| `the verdict is for another request` | `propose`, `approve` |
| `the verdict has no audio digest of 32 bytes` | `propose`, `approve` |
| `this recording already counted` | `propose`, `approve` |
| `the proposal has <n> of <threshold> approvals` | `execute` |
| `salt_hex must be 64 lowercase hex characters` | `execute` |
| `execute takes receiver and amount_yocto for a transfer, or note_id for a hide` | `execute` |
| `receiver must be a named account that the grammar can speak` | `execute` |
| `amount_yocto must be a multiple of 0.01 NEAR from 0.01 to 1,000,000 NEAR` | `execute` |
| `receiver, amount_yocto and salt_hex do not match the commitment` | `execute` |
| `this multisig has no notes contract` | `execute` of a hide |
| `note_id and salt_hex do not match the commitment` | `execute` of a hide |
| `Exceeded the account balance.` (the runtime, at the transfer) | `execute` |
| `Method <name> doesn't accept deposit` | `propose`, `approve`, `execute` |
| `Method on_transfer is private` | `on_transfer` |

## Gas and storage

Measured in the nearcore 2.14.0 sandbox (`sandbox/tests/sandbox.rs`), 30 Tgas
attached, 3 signers and a threshold of 2, on 2026-11-12. The `execute` rows
are the total of the call, the transfer and the callback.

| Call                                | Gas burnt |
| ----------------------------------- | --------- |
| `new`                               | 1.71 Tgas |
| `propose`                           | 2.47 Tgas |
| `approve`                           | 2.48 Tgas |
| `execute`, the transfer arrives     | 4.96 Tgas |
| `execute`, the transfer fails       | 5.14 Tgas |
| `execute`, a hide (50 Tgas attached)| 6.68 Tgas |

`approve` checks a verdict now, so it burns about 0.55 Tgas more than the
plain `approve` of 2.x (1.93 Tgas). A 2 of 3 proposal (`propose`, one
`approve` and `execute`) burns about 9.9 Tgas in total.

One proposal with 3 voice approvals uses 388 bytes of contract storage, with
the 3 recordings (`alice.test.near`-length accounts; 0.0039 NEAR at 10^19
yoctoNEAR a byte). The reproducible build of the code is 214,166 bytes,
about 2.15 NEAR. The contract balance pays for all storage and for the transfers.

## Build and test

### Reproducible build

This build gives the WASM to deploy. It gives the same bytes on any computer
(see [`../README.md`](../README.md#reproducible-build)). It needs Docker,
git and cargo-near 0.22.0.

```bash
../reproducible.sh build voice-multisig   # writes res/voice_multisig.wasm and reproducible.sha256
../reproducible.sh check voice-multisig   # builds the recorded commit again and compares
```

The build of 12 Nov 2026 of version 3.0.0 is the code on
`voice-multisig.seams-v1.testnet`. The code on `multisig.seams-v1.testnet`
was the 2.x build of commit `777b844`, until that account was deleted (see
"Deployed code").

| Item               | Value |
| ------------------ | ----- |
| Commit             | `99231f6660ce7fb8823a4796918bff10a8a8b323` (on `dev`) |
| Size               | 214,166 bytes |
| SHA-256            | `ae988e20b474a4f673ca983a6949f9654cd16fc2dfc50ba6615dd26aa7e715eb` |
| Code hash (base58) | `CkYrt1XM3NDsdd7B8PVx2eyUh36nM3nQtmvbta8eQTnA` |

`reproducible.sha256` holds the same commit and SHA-256. Both sandbox tests
pass with this WASM (`VOICE_MULTISIG_WASM=res/voice_multisig.wasm`).
SourceScan built the commit again and got the same code hash, so NearBlocks
shows the code as verified at
<https://testnet.nearblocks.io/address/voice-multisig.seams-v1.testnet/contract>.

### Local build

```bash
./build.sh
```

The script builds `res/voice_multisig.wasm` with the local toolchain. It is
fast, and the sandbox test uses it. Its bytes depend on the computer, because
the WASM holds the local source paths of panic locations. The build of 12 Nov
2026 of 3.0.0 gave 258,856 bytes, SHA-256
`2f91d85e9e933e2d10b89ce08c32dda35d43ff99eeb3f6d3efbafffcf1fbfd54`.

### Tests

```bash
cargo test -p voice-multisig
```

The 84 unit tests sign real verdicts with a test ed25519 key. They cover
each rule of `new`, `propose`, `approve` and `execute`: a plain approve
without a verdict, the verdict of a non-signer or of another signer, the
same verdict twice, one recording for two signers or two proposals, a
verdict for another commitment or proposal, and an execute below the
threshold. They also cover the amount range of the grammar (1,000,000 NEAR
passes, 1,000,000.01 NEAR fails) and the failed transfer that opens the
proposal again. One test checks the verifier's shared vector
(`crates/voice-verifier/testdata/signed_verdict_v2.json`): its signature
passes, and the contract refuses it as a transfer verdict.

```bash
./build.sh && ../community-notes/build.sh && cargo test -p voice-multisig-sandbox -- --nocapture
```

The sandbox test deploys the contract with 3 signers, a threshold of 2 and
10 NEAR, and runs three proposals: one whose 0.01 NEAR arrives at the
receiver, one whose receiver does not exist, so the callback opens it
again, and one of 12 NEAR, above the balance, so `execute` fails and the
proposal stays open. It also checks these failures on the real runtime: a
plain approve with only `{"proposal_id"}`, a non-signer that proposes,
approves or executes, the verdict of a non-signer, a verdict for another
commitment, the same verdict twice, a recording that counted, an execute
below the threshold, a wrong signature, an expired verdict, a wrong salt,
deposits and the private methods. A second test hides a note of the
community-notes contract with 2 of 2 voice approvals.

## Deploy to testnet

Version 3.0.0 has its own contract account. Its state (signers, threshold,
recordings) is not the state of 2.x (admins), and the open 2.x proposals
have admin approvals that are not voices. So a migration in place on
`multisig.seams-v1.testnet` would carry approvals that no voice gave. So
3.0.0 got a new account. The 2.x account was deleted later on 2026-11-12
(see "Deployed code").

The steps below are the record of the deploy of 2026-11-12 and the way to
deploy again. Each step waits for the owner's go-ahead. Each signer must
have an enrolled voice in the verifier (`enroll`) before it proposes or
approves, and two signers need two different voices (`same_speaker`).

1. Make the reproducible build from a commit on `dev` (cargo-near 0.22.0,
   Docker), commit `reproducible.sha256`, and push `dev`, so SourceScan can
   build the commit again:

   ```bash
   ../reproducible.sh build voice-multisig
   ```

2. Create the contract account. 3 NEAR covers the code (about 2.15 NEAR).
   Tx `5PWHCXLPb6aKyZGRkevkoMhfPVhfqH3Fn5uQ12DV6R9x`:

   ```bash
   near account create-account fund-myself voice-multisig.seams-v1.testnet '3 NEAR' autogenerate-new-keypair save-to-legacy-keychain sign-as seams-v1.testnet network-config testnet sign-with-legacy-keychain send
   ```

3. Deploy the WASM with the signers, the threshold and the verifier key.
   Tx `FUAfW1AeZMMarjVThdDtmdXAhPw1ghZt2U6FSMF83rxs` (17.4 Tgas):

   ```bash
   near contract deploy voice-multisig.seams-v1.testnet use-file res/voice_multisig.wasm with-init-call new json-args '{"signers":["cyan-loong.testnet","seams-v1.testnet"],"threshold":2,"verifier_public_key":"ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U"}' prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-legacy-keychain send
   ```

4. Name the notes contract. Tx
   `9xESGGc9s7kkfs8W7pHEcWhjx1mnZpBaKkdTQXZVv2y7`:

   ```bash
   near contract call-function as-transaction voice-multisig.seams-v1.testnet set_notes_contract json-args '{"account_id":"notes.seams-v1.testnet"}' prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' sign-as voice-multisig.seams-v1.testnet network-config testnet sign-with-legacy-keychain send
   ```

   A hide works only when the notes contract names this multisig as its
   moderator. The notes contract has one moderator. It was
   `multisig.seams-v1.testnet` (2.x) until that account was deleted on
   2026-11-12. The switch to this multisig ran on 2026-11-12, tx
   `67yt21jDwFhcRXc6Ku8xeKutiyhPN8B2pnkL7iX1QM5D`:

   ```bash
   near contract call-function as-transaction notes.seams-v1.testnet set_moderator json-args '{"account_id":"voice-multisig.seams-v1.testnet"}' prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' sign-as notes.seams-v1.testnet network-config testnet sign-with-legacy-keychain send
   ```

5. Fund the multisig with a plain transfer. Tx
   `HWAFhCd7zWWM3ZrPK1tRQFhfD9Agc9NFNbdvB66uqW7o` (2 NEAR, 5.00 NEAR in
   all, of which about 2.15 NEAR holds the code):

   ```bash
   near tokens seams-v1.testnet send-near voice-multisig.seams-v1.testnet '2 NEAR' network-config testnet sign-with-legacy-keychain send
   ```

6. Read the config, and ask SourceScan to verify the code (see
   [`../README.md`](../README.md#the-deployed-code)). It answered
   `{"message":"Contract verified successfully","checksum":"CkYrt1XM3NDsdd7B8PVx2eyUh36nM3nQtmvbta8eQTnA"}`:

   ```bash
   near contract call-function as-read-only voice-multisig.seams-v1.testnet get_config json-args '{}' network-config testnet now
   ```

   ```bash
   curl -s -X POST https://api-v2.sourcescan.dev/api/verify/rust -H 'Content-Type: application/json' -d '{"accountId":"voice-multisig.seams-v1.testnet","networkId":"testnet"}'
   ```

The verifier key is `ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U`.
It is the verdict key of the OutLayer project
`seams-v1.testnet/voice-verifier` for runs that the Seams payment key pays
for, and it stays the same across versions. The verifier has
`multisig_propose`, `multisig_hide_note` and `multisig_confirm` since 0.6.0
(the hide since 0.7.0), so 3.0.0 needs no new verifier version.

## Live run on testnet

A second account, `voice-multisig-2.seams-v1.testnet`, runs the same verified
build of commit `99231f6` (code hash
`CkYrt1XM3NDsdd7B8PVx2eyUh36nM3nQtmvbta8eQTnA`), with 2 of 2 signers. Each
signer is a Seams Wallet account with an enrolled voice. The page is
`/multisig/` of the demo (`demo/frontend/src/multisig/`).

| Signer | Account |
| --- | --- |
| A | `67f83c69190537f2432abd961be298ac44f5e161e152dc310a1d29a88a284577` |
| B | `c3abe0951c8d0659e4d3514c2625afc47bad082c821ef76726dac3e766ef4632` |

Each transaction below has the signed verdict of the verifier in its
arguments (`verdict_json` and `signature_b64`). The contract checked the
signature, the owner and the commitment before it changed its state. To read
a verdict, open the transaction and look at the arguments of the call.

### Proposal 3: two persons, two voices (2026-11-12)

Before this proposal, each signer enrolled a voice again: signer A is one
person, and signer B is another person. Each said the same sentence:
"Approve proposal three: send zero point one NEAR to seams dash faucet dot
testnet".

| Step | Transaction | What the verdict says |
| --- | --- | --- |
| Signer A proposes | [`9VhY5XVYFaT5jXpYGVvpnz3GFnNVkUnX8CH4AY5Yd9kb`](https://testnet.nearblocks.io/txns/9VhY5XVYFaT5jXpYGVvpnz3GFnNVkUnX8CH4AY5Yd9kb) | `accept`, speaker score 746 (the cutoff is 450), heard "approve proposal three send zero point one near to seams dash faucet dot testnet" |
| Signer B approves | [`7sBTQskwjpmZMgiUa5bTD4WTJB45HKtvjpU2H4E82mKP`](https://testnet.nearblocks.io/txns/7sBTQskwjpmZMgiUa5bTD4WTJB45HKtvjpU2H4E82mKP) | `accept`, speaker score 790. The verifier did not refuse it as `same_speaker`: the voice of signer B is not the voice of signer A. |
| Signer A executes | [`27rHJo5reVM1vokTakJ9z53VmhTQV2fKAmfyKMwvNZ5x`](https://testnet.nearblocks.io/txns/27rHJo5reVM1vokTakJ9z53VmhTQV2fKAmfyKMwvNZ5x) | No verdict: `execute` opens the hidden transfer with its salt. The contract checked that the receiver, the amount and the salt give the stored hash. |

The contract logged `proposed` for the first transaction, `approved` with
`"approvals":2` for the second, and `executed` for the third. The chain held
only the salted hash of the transfer (`89fe7771…20df`) until `execute`. Then
0.1 NEAR went to `seams-faucet.testnet`, and `get_proposals` shows proposal 3
as `executed`.

Facts of this proposal:

- Both verdicts name the verifier `0.14.1+venice`. NEAR AI Whisper gave no
  reply on that day, so the `venice` build heard the words: Venice AI, which
  has no TEE (`crates/voice-verifier/README.md`, "Speech-to-text service").
  The speaker check and the signature are the same as in the default build.

### Proposal 2: one person cannot approve two times (2026-11-12)

Signer B proposed the same transfer by voice:
[`6WcVLmKtVT5JRK1ECAQCfMNVstAB6yRnPxx48HN9W2cB`](https://testnet.nearblocks.io/txns/6WcVLmKtVT5JRK1ECAQCfMNVstAB6yRnPxx48HN9W2cB)
(`accept`, verifier 0.12.0, speaker score 748).

Then the same person tried to approve as signer A, with a higher and a lower
tone of the same voice. The verifier refused the recording as `same_speaker`: it matched the
voice that had said the proposal. So no approval of signer A exists, and the
proposal stays open with 1 of 2. This refusal was an answer of the verifier
to the page. It is not on chain, so this file has no link for it.

Later, a different person said the proposal as signer A. The verifier did not
refuse that voice as `same_speaker`. It refused the words, because the
speech-to-text model heard the account name wrong ("scenes fawcett" for
"seams dash faucet"). An approval needs the exact words. This refusal is not
on chain either.

### Proposal 1: two persons, and a speech-to-text error (2026-11-12)

Signer A proposed the transfer by voice:
[`4ZnfvisXw1TaakV9ASkJBviReao7sUYa4XfckvhmJNMn`](https://testnet.nearblocks.io/txns/4ZnfvisXw1TaakV9ASkJBviReao7sUYa4XfckvhmJNMn)
(`accept`, verifier 0.12.0, speaker score 627).

Another person said the proposal as signer B. The voice passed (speaker
score 773), and the verifier did not refuse it as `same_speaker`. But NEAR AI
Whisper heard "zero point one nil to seamsfaucet dot testnet" for "zero
point one NEAR to seams dash faucet dot testnet", so the verifier refused
the words. The page sent that signed refusal to the contract as a record:
[`13UoZ4hXS6nmeBqrPAL6mjbWfBsbuL7GqkRGoKfMwPSL`](https://testnet.nearblocks.io/txns/13UoZ4hXS6nmeBqrPAL6mjbWfBsbuL7GqkRGoKfMwPSL).
The contract refused it with "the verdict outcome must be accept": only an
`accept` verdict counts as an approval.

After three recordings with wrong heard words, signer B has no tries left
for this proposal (`attempts_exhausted`). The proposal stays open with 1 of
2. This is a limit: a made-up account name such as `seams-faucet` is hard
for a speech-to-text model, and an approval needs the exact words.

## Deployed code

`voice-multisig.seams-v1.testnet` runs version 3.0.0 since 2026-11-12: the
reproducible build of commit `99231f6` (214,166 bytes, SHA-256
`ae988e20b474a4f673ca983a6949f9654cd16fc2dfc50ba6615dd26aa7e715eb`, code
hash `CkYrt1XM3NDsdd7B8PVx2eyUh36nM3nQtmvbta8eQTnA`, verified by
SourceScan). The signers are `cyan-loong.testnet` and `seams-v1.testnet`,
and the threshold is 2. The notes contract is `notes.seams-v1.testnet`, and
the notes contract names this multisig as its moderator since 2026-11-12.
The transactions are in "Deploy to testnet". No proposal exists on this
account: its two signers have no enrolled voices. The proposals by voice ran
on `voice-multisig-2.seams-v1.testnet`; see "Live run on testnet" above.

`multisig.seams-v1.testnet` ran version 2.x until 2026-11-12, when the
account was deleted. In 2.x, any account that was not an admin proposed by
voice, and the admins `admin-a.seams-v1.testnet` and
`admin-b.seams-v1.testnet` approved with plain signed calls. Its source is
commit `777b844` (`git show 777b844:demo/contracts/voice-multisig/README.md`
has its interface). The demo site had no page for it since `d412a9a`.

- 2026-11-10: deploy and `new`, tx
  `BcBCruDvJ5MCyDPxRKqm7BCCXgUuyr1NfmeFXXZg6Dwz` (code `c3f420b8…e037`),
  with about 10.5 NEAR.
- 2026-11-11: the code of `dev` 01dde86, with the hide of a note, no init
  call: tx `DfXs4nJpJTMgiK5RnvfwAWdzEwiF6BnkokXGkY7J4rSk`.
  `set_notes_contract` to `notes.seams-v1.testnet`: tx
  `A3zL4SZ4iDXXLAzpYZNzZf8n3VqsFbEBTzR9Qk2mfDMu`.
- 2026-11-11: the reproducible build of commit `777b844` (210,878 bytes,
  SHA-256 `95208e2a2b5091c677ad0e521fea43f7bc74d5a661981553b8ed5d835110e644`,
  code hash `B38YGRGymzWML2WoNz2TLqLe5z1vmKc1wjcHYRCEUahh`), no init call:
  tx `Exeu3mx8x1VZdheteCWAVvduEZo3H6FSeNLqsfusDD7t`. SourceScan built the
  commit again and got the same code hash, so NearBlocks showed the code as
  verified.
- 2026-11-12: the account was deleted. NEAR refuses to delete an account
  with more than 10 kB of storage, so an empty 8-byte WASM module replaced
  the code first: tx `5VHiCTSsjYgFEgKtwYaeJpziLgnVjxG3gr85PusSSwAX`. Then
  `delete-account` with the beneficiary `seams-faucet.testnet` sent its
  10.49 NEAR to the faucet: tx
  `946SabSDyNPet3s9cTFT9EWcjEGR1tByyVq7pJVaa4y5`.

The first deploy, `team.seams-v1.testnet` (2026-11-10, code
`d82479ab…e327`), had a cap of 0.05 NEAR. It stays on chain.
