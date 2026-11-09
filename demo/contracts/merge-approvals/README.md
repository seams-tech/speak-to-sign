# Merge approvals contract

A NEAR contract for the spoken PR merge demo (`demo/frontend`, `/merge/`). A
maintainer says "merge pull request four hundred twelve into main". The
attested verifier checks the voice and the words, and the Seams Wallet signs
`approve_merge` from the maintainer's own account with 0 deposit and 30 Tgas.
This contract records that approval of one commit. It merges nothing: the
record is the signed merge message. Testnet only.

The interface is shared with the Wallet side (the new spoken request kind):
`merge-approval-spec.md` in the session notes, and this README.

## Toolchain

The same as `../community-notes/`: Rust 1.97.0 (`rust-toolchain.toml`),
near-sdk 5.30.1, near-workspaces 0.24.0 with the nearcore 2.14.0 sandbox.
`.cargo/config.toml` adds `--cfg near` to each WASM build, so a failed call
keeps its message on chain.

## Interface

The approver is `predecessor_account_id`. Ids are JSON numbers. The change
method does not accept a deposit: a call with a deposit fails.

| Method          | Kind   | Arguments                                                                 | Returns |
| --------------- | ------ | ------------------------------------------------------------------------- | ------- |
| `approve_merge` | change | `{"repo": String, "pull_request": u64, "base": String, "head_commit": String}` | `u64`, the approval id |
| `get_approvals` | view   | `{"repo": String, "pull_request": u64}`                                   | `ApprovalView[]`, newest first, at most 50 |
| `get_approval`  | view   | `{"approval_id": u64}`                                                    | `ApprovalView` or `null` |

Rules:

- `repo` is `owner/name`. The owner has 1 to 39 letters, digits or inner hyphens. The name has 1 to 100 letters, digits, dots, underscores or hyphens, and is not `.` or `..`.
- `pull_request` is 1 or more.
- `base` is the target branch: 1 to 32 lowercase letters a-z, because it is spoken ("into main").
- `head_commit` is the git commit id: 40 lowercase hex characters.
- One approval exists for each repo, pull request, base, commit and approver. A repeat keeps its id and updates `approved_at_ms`.
- Approval ids start at 1 and increase by 1.

`ApprovalView`:

```json
{
  "id": 2,
  "repo": "seams-tech/speak-to-sign",
  "pull_request": 412,
  "base": "main",
  "head_commit": "9c1e2fa4b7d0c3e5f6a8b9c0d1e2f3a4b5c6d7e8",
  "approver": "maya.testnet",
  "approved_at_ms": 1762700000000
}
```

Each `approve_merge` call, a repeat too, logs one NEP-297 event:

```text
EVENT_JSON:{"standard":"merge_approvals","version":"1.0.0","event":"merge_approved","data":[{"approval_id":2,"repo":"seams-tech/speak-to-sign","pull_request":412,"base":"main","head_commit":"9c1e2fa4b7d0c3e5f6a8b9c0d1e2f3a4b5c6d7e8","approver":"maya.testnet"}]}
```

Failure messages: `repo must be owner/name`, `repo owner must be 1 to 39
letters, digits or inner hyphens`, `repo name must be 1 to 100 letters,
digits, dots, underscores or hyphens`, `pull_request must be 1 or more`,
`base must be 1 to 32 lowercase letters a-z`, `head_commit must be 40
lowercase hex characters`, and `Method approve_merge doesn't accept deposit`.

## Gas and storage

Measured in the nearcore 2.14.0 sandbox (`sandbox/tests/sandbox.rs`):

| Call                                     | Gas burnt |
| ---------------------------------------- | --------- |
| `approve_merge`, longest repo (140 characters) | 2.41 Tgas |
| `approve_merge`                          | 2.37 Tgas |
| `approve_merge`, a repeat                | 2.00 Tgas |

The largest approval uses 1,083 bytes of contract storage (0.011 NEAR at
10^19 yoctoNEAR a byte). The contract code uses about 1.6 NEAR. The contract
balance pays for all storage; if it is too low, a call fails with
`LackBalanceForState`.

## Build and test

```bash
./build.sh
```

The build of 9 Nov 2026 gave `res/merge_approvals.wasm`, 161,371 bytes,
SHA-256 `9b9ca2f2ffff5cb8b29b718d5dfb2e75608f924d38fa13682cd51344927f6828`.

```bash
cargo test -p merge-approvals
```

```bash
./build.sh && cargo test -p merge-approvals-sandbox -- --nocapture
```

## Testnet deployment

Deployed on 9 Nov 2026 from commit `eed641a` (the source has not changed since).

| Item               | Value                                                                  |
| ------------------ | ---------------------------------------------------------------------- |
| Contract account   | `github.seams-v1.testnet` (created by `seams-v1.testnet` with 3 NEAR)   |
| Code hash (base58) | `BUSix8iRMdLeEjd1yVn7r5Sk4NWUZVuopXPcsm44KHcT`, the SHA-256 of the release WASM above |
| Create account     | transaction `7U7cjHkx5ENdpKbvbL7vWCKvw8gEjjpxaBgezL5JmpVr`             |
| Deploy             | transaction `EkUHakC3kqVF44gz82CAyTmY1PW5SNLinphTJNTFTzGV`             |
| Smoke test         | `approve_merge` from `seams-v1.testnet`, transaction `BRrRMw9PSqXoQPGgngEWBZhp5MLvShXFBpj7NX2vSeRp`, 2.4 Tgas |

The smoke test approved `seams-tech/smoke-test` pull request 1 (approval 1),
not the demo pull request, so the demo screen shows only voice approvals. The
first voice approval of the demo pull request gets id 2.

## Deploy to testnet

The commands for a new deployment. Replace `github.seams-v1.testnet` with a
new account name.

```bash
near account create-account fund-myself github.seams-v1.testnet '3 NEAR' autogenerate-new-keypair save-to-legacy-keychain sign-as seams-v1.testnet network-config testnet sign-with-legacy-keychain send
```

```bash
near contract deploy github.seams-v1.testnet use-file res/merge_approvals.wasm without-init-call network-config testnet sign-with-legacy-keychain send
```

```bash
near contract call-function as-read-only github.seams-v1.testnet get_approvals json-args '{"repo":"seams-tech/speak-to-sign","pull_request":412}' network-config testnet now
```
