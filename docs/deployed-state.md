# What is live, and how it differs from the source

The source on `dev` and the live testnet state are not always the same. This
page lists each live part, the source that it comes from, where the two
differ, and one command to check it again. Read it before you trust a claim
about what runs on testnet.

Checked on 2026-11-12. Each check below is a read-only view.

## The helpers

These are the same helpers as step 5 of [`terminal-checks.md`](terminal-checks.md) (FastNear RPC, because
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
| Active version on OutLayer (a call with no `version_key`) | 0.14.1, `1e7c6968…8a5c`, since 2026-11-12 (`set_active_version` tx `GnXazq3d4UukDyGMm6FPGoCvrCEQhwniHKGAMr8vc6rC`). It is the worker with the NEAR AI check. Before it on that day: 0.14.1+venice for about 25 minutes, while NEAR AI Whisper gave no reply (tx `HTQ5QvR187yiKCA9KUYeFh1PHmZUQWJggaenCkxoCYX7`), and 0.12.0 from 2026-11-11. | Commit `62cd438`; JUDGES.md check 3 builds it | No |
| 0.12.0 and 0.13.0 | `bfe81633…c946` and `1b777154…f930`. Removed from the project on 2026-11-12, when no caller used them: the Seams staging server moved to 0.14.1 (`remove_version` txs `2XGQZT5GGJkoVbiCe34VaTZiPkaVDvFxHTLMnhscJVc4` and `3AVPXQTpVkh7cwCvUyDRrN1fdrQ2QyJtSPec53mrWMZB`). A call with one of these keys fails. | Commits `a816798` and `a4d6ce7` | |
| Versions that the Seams staging server calls (a transfer, a note, a rating, a bet) | Since the deploy of 2026-11-12 (Seams Wallet 0.70.0): 0.14.1, `1e7c6968…8a5c`, while NEAR AI Whisper answers, and 0.14.1+venice, `344b8b47…d3c8`, while it is down. The server checks NEAR AI once a minute and selects the build by `version_key`; the page cannot select it. The TDX quote check accepts only the hash of the build that the server called. | `seams-monorepo` `deployment/wallet-system/targets.json` (`versionKey`, `veniceVersionKey`), commit `c84f0815` | No |
| Versions that the demo route `/api/voice-verify` calls (the multisig page) | Since the deploy of 2026-11-12: 0.14.1 while NEAR AI Whisper answers, and 0.14.1+venice while it is down. The route checks Whisper before each call, and a request can name the service. The answer names it in the header `X-Speech-To-Text`. | `demo/frontend/functions/api/voice-verify.ts` | No |
| Verdict key | `ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U`, bound to the project, so every version signs with it | `crates/voice-verifier/manifest/outlayer.json` | No |
| HTTPS API and secrets | `https://testnet-api.outlayer.ai/call/seams-v1.testnet/voice-verifier`, with `secrets_ref` `{"profile":"main","account_id":"cyan-loong.testnet"}` | `crates/voice-verifier/README.md` | No |
| Worker with the NEAR AI check | 0.14.1, `1e7c6968…8a5c` (495,774 bytes), added on 2026-11-12, **active**. The demo route selects it by its key while NEAR AI Whisper answers. | Commit `a519647` | No |
| Worker for a NEAR AI Whisper outage (the `venice` build) | 0.14.1+venice, `344b8b47…d3c8` (400,267 bytes), added on 2026-11-12, **not active**. The demo route selects it by its key while NEAR AI Whisper is down. It sends the recording to Venice AI over TLS, with no TEE check. On 2026-11-12 two real recordings passed through it: [the live multisig run](../demo/contracts/voice-multisig/README.md#live-run-on-testnet). | Commit `62cd438`, `./build.sh --venice --docker` | No |
| The verifier source on `dev` | 0.14.1: both of its builds are on OutLayer. The default build is active. | Commit `a519647` | No |
| Builds that were removed | 0.14.0+venice, `59ee371c…fa66` (Venice AI answered 422 to each request), 0.14.0 with `dcap-qvl`, `2f8e75a3…7ffb5` (it loaded about 1 s slower), and 0.14.0, `b9a315b7…9293` (the same worker as 0.14.1, before the `venice` fix). Removed from the project on 2026-11-12 (`remove_version` txs `8qEVS3jc68r8WAaVGGoP7NpWp2etexeiwsw8GBMTBxX`, `Akuxz76BL6H9CRZWEsR525dfYv3Um2SoFTcPtYUBGV9E` and `GCQXS8oMUiastKAv6u4cyrMBiK1w9huVpTvRtJZgGku9`). A call with one of these keys fails. | Commits `454c76e` and `6f0d43f` | |

```bash
view outlayer.testnet get_project '{"project_id":"seams-v1.testnet/voice-verifier"}' | jq -r .active_version
```

The project has two versions: 0.14.1 and 0.14.1+venice. On 2026-11-12 the
owner removed the 27 other versions, when no caller used them. A call with the key of a removed version fails. The history of each
version and the transaction of each removal are in
[`crates/voice-verifier/README.md`](../crates/voice-verifier/README.md#versions).

```bash
# See: 2
view outlayer.testnet get_version_count '{"project_id":"seams-v1.testnet/voice-verifier"}'
```

## The contracts

| Account | Live code hash | Source build | Voice check on chain |
| --- | --- | --- | --- |
| `notes.seams-v1.testnet` | `724jz1XP…btU7c` = SHA-256 `596beeb3…d9c3`, the build of commit `119ef0e` | The same | **Yes.** `get_voice_config` returns `"required":true`. |
| `pm-notes.seams-v1.testnet` | `7qA3mFHg…nQ9Z` = `657c3b07…`, the build of commit `777b844` | The same | **Yes.** `get_voice_config` returns `"required":true`. |
| `voice-multisig.seams-v1.testnet` | `CkYrt1XM…QTnA` = `ae988e20…`, the build of commit `99231f6` (version 3.0.0) | The same | **Yes.** Each `propose` and `approve` needs a verdict. No proposal has run on this account: its signers have no enrolled voices. The live run is on `voice-multisig-2.seams-v1.testnet`, which runs the same build: see [the live run](../demo/contracts/voice-multisig/README.md#live-run-on-testnet). |
| `seams-faucet.testnet` | `6d8BGwTR…fR2z` = `538b7580…`, the build of commit `777b844` | The same | No voice step (it is the faucet). |

```bash
for a in notes.seams-v1.testnet pm-notes.seams-v1.testnet voice-multisig.seams-v1.testnet seams-faucet.testnet; do echo "$a $(code_hash $a)"; done
view notes.seams-v1.testnet get_voice_config '{}'
view pm-notes.seams-v1.testnet get_voice_config '{}'
view notes.seams-v1.testnet get_moderator '{}'
```

The moderator of the notes contract is `voice-multisig.seams-v1.testnet`.

## The Wallet and the site

| Item | Live | Notes |
| --- | --- | --- |
| Wallet SDK | `@seams/wallet` 0.70.1 on `staging.sign.seams.sh`, `test.sign.seams.sh` and `sign.seams.sh` since 2026-11-13 (`/wallet-assets.manifest.json` of each origin) | Pinned in `demo/frontend/package.json`; source [`seams-wallet` at 0.70.1](https://github.com/seams-tech/seams-wallet/tree/26e42d3562ba7897ef891c6cad722ac1686e2956) |
| Demo site | https://speak-to-sign.pages.dev, deployed on 2026-11-12 from `dev` at commit `44cf3b8` (Pages deployment `c4650917`, Seams Wallet 0.70.0) | It has the spoken multisig page `/multisig/`, and the route that selects NEAR AI or Venice AI for each voice check. Its posts timeline shows only posts about science, technology, business and politics. Check: `curl -s https://speak-to-sign.pages.dev/api/near-ai-status` gives the state of NEAR AI and of its Whisper. |

## Checks that are in progress

These are designed and recorded, but not live on 2026-11-12. Do not count them
as live until this table says so.

| Check | Where | State |
| --- | --- | --- |
| The Seams verify route checks the TDX quote of each verifier call against the WASM hash of the build that it called | `seams-wallet`, `speakToSignAttestation.ts` | **Live on the Seams staging server** since 2026-11-12 (Seams Wallet 0.70.0, `seams-wallet` `35649a05b`). A spoken request through it with a real voice is not recorded here yet. See [trust-chain.md](trust-chain.md), link 2. |
| The verifier checks the TDX quotes of NEAR AI's gateway and Whisper, and sends each recording to Whisper only sealed to the checked gateway | `crates/voice-verifier` on `dev` (`src/nearai_attestation.rs`, `src/tdx_quote.rs`, `src/ohttp.rs`) | **Live.** Verifier 0.14.1 (`1e7c6968…`) is the active version on OutLayer, and the Seams staging server and the demo route `/api/voice-verify` call it (the demo route selects `0.14.1+venice` while Whisper is down). On 2026-11-12, after NEAR AI Whisper answered again, 6 of 6 `verify` calls on it gave `accept`: each recording went sealed to the checked gateway (`tee_cached` 1), and the sealed reply gave the heard words. In the same run, in turn with 0.13.0: `time_ms` median 3,119 against 3,523, and the worker's own `total` 1,962 ms against 1,935 ms. So the check adds no time. On 2026-11-13 at 03:25 UTC the worker made a new check on OutLayer with its own TDX quote code (`tee_cached` 0, 1.6 s for the report, Intel's collateral and the two quote checks): the check passed, and that `verify` call gave `accept`. The next call read the stored result (`tee_cached` 1). See [trust-chain.md](trust-chain.md#the-near-ai-check). |
| One live 2-of-2 voice multisig proposal | `voice-multisig-2.seams-v1.testnet` | **Done.** On 2026-11-12 two persons proposed and approved one transfer by voice, and the contract executed it (0.1 NEAR to `seams-faucet.testnet`). See [the live run](../demo/contracts/voice-multisig/README.md#live-run-on-testnet). |

When one of these ships, change its row here first, then the docs that link
to this page.
