# What is live, and how it differs from the source

The source on `dev` and the live testnet state are not always the same. This
page lists each live part, the source that it comes from, where the two
differ, and one command to check it again. Read it before you trust a claim
about what runs on testnet.

Checked on 2026-11-12. Each check below is a read-only view.

## The helpers

These are the same helpers as README step 5 (FastNear RPC, because
`rpc.testnet.near.org` answers HTTP 429 after a few dozen calls):

```bash
view() { curl -s https://rpc.testnet.fastnear.com -H 'Content-Type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"$1\",\"method_name\":\"$2\",\"args_base64\":\"$(printf '%s' "$3" | base64 | tr -d '\n')\"}}" | jq -r '.result.result | implode'; }
code_hash() { curl -s https://rpc.testnet.fastnear.com -H 'Content-Type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$1\"}}" | jq -r .result.code_hash; }
```

A code hash is the base58 form of the SHA-256 of the WASM. Compare it with the
last line of the contract's `reproducible.sha256`.

## The verifier

| Item | Live | Source | Differs? |
| --- | --- | --- | --- |
| Active version on OutLayer (a call with no `version_key`) | 0.12.0, `bfe81633…c946` | Commit `a816798`; JUDGES.md check 3 builds it | No |
| Version that the demo calls | 0.13.0, `1b777154…f930`, not active. The Seams staging server selects it by `version_key`. | Commit `a4d6ce7` | No |
| Verdict key | `ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U`, bound to the project, so every version signs with it | `crates/voice-verifier/manifest/outlayer.json` | No |

```bash
view outlayer.testnet get_project '{"project_id":"seams-v1.testnet/voice-verifier"}' | jq -r .active_version
```

The full list of versions is in README "Testnet facts" and in
`crates/voice-verifier/README.md`.

## The contracts

| Account | Live code hash | Source build | Voice check on chain |
| --- | --- | --- | --- |
| `notes.seams-v1.testnet` | `mvYopouU…9eUko` = SHA-256 `0b821a5c…7f80`, the build of commit `777b844` | `reproducible.sha256` now holds `596beeb3…`, the build of commit `119ef0e`, **not deployed** | **No.** The source checks the verdict of each note and rating (`check_spoken`), but the live build does not. Only Wallet core and the Seams co-signer check a note's verdict. |
| `pm-notes.seams-v1.testnet` | `7qA3mFHg…nQ9Z` = `657c3b07…`, the build of commit `777b844` | The same | **Yes.** `get_voice_config` returns `"required":true`. |
| `voice-multisig.seams-v1.testnet` | `CkYrt1XM…QTnA` = `ae988e20…`, the build of commit `99231f6` (version 3.0.0) | The same | **Yes.** Each `propose` and `approve` needs a verdict. No proposal has run yet. |
| `seams-faucet.testnet` | `6d8BGwTR…fR2z` = `538b7580…`, the build of commit `777b844` | The same | No voice step (it is the faucet). |

```bash
for a in notes.seams-v1.testnet pm-notes.seams-v1.testnet voice-multisig.seams-v1.testnet seams-faucet.testnet; do echo "$a $(code_hash $a)"; done
view pm-notes.seams-v1.testnet get_voice_config '{}'
view notes.seams-v1.testnet get_moderator '{}'
```

`get_voice_config` on `notes.seams-v1.testnet` fails with `MethodNotFound`,
because the live build is older than the voice rule. The moderator of the
notes contract is `voice-multisig.seams-v1.testnet`.

## The Wallet and the site

| Item | Live | Notes |
| --- | --- | --- |
| Wallet SDK | `@seams/wallet` 0.69.2 | Pinned in `demo/frontend/package.json`; source [`seams-wallet` at 0.69.2](https://github.com/seams-tech/seams-wallet/tree/e9fdc65ae8ae269499dfce423412e446a87d3f0d) |
| Demo site | https://speak-to-sign.pages.dev, built from `dev` | The page has no multisig route. |

## Checks that are in progress

These are designed and recorded, but not live on 2026-11-12. Do not count them
as live until this table says so.

| Check | Where | State |
| --- | --- | --- |
| The Seams verify route checks the TDX quote of each verifier call against the pinned WASM hash | `seams-wallet`, `speakToSignAttestation.ts` | Built on `seams-wallet` `dev` at `0b297e976`. A deploy of the Seams staging server is not recorded here yet. See [trust-chain.md](trust-chain.md), link 2. |
| The verifier checks NEAR AI's attestation of Whisper, with a cache | `crates/voice-verifier`, branch `claude/nearai-attestation-cache-8506f2` | Built and tested (commit `e8d7400`), **not shipped** by the owner's decision of 2026-11-12: it adds about 0.5 s to each call. See [trust-chain.md](trust-chain.md#why-the-near-ai-check-is-not-shipped). |
| One live 2-of-2 voice multisig proposal | `voice-multisig.seams-v1.testnet` | Planned. No proposal has run. |
| The voice check of the notes contract | `notes.seams-v1.testnet` | Built (commit `119ef0e`), not deployed. |

When one of these ships, change its row here first, then the docs that link
to this page.
