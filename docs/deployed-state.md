# What is live, and how it differs from the source

The source on `dev` and the live testnet state are not always the same. This
page lists each live part, the source that it comes from, where the two
differ, and one command to check it again. Read it before you trust a claim
about what runs on testnet.

Checked on 2026-11-14. Each check below is a read-only view.

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
| Active version on OutLayer (a call with no `version_key`) | 0.15.0, `21af4130…27d9`, since 2026-11-14 (`set_active_version` tx `859jnFSeuLjfaDns57EnmA1DVZQJrXC3tV81asdjFS8Z`). It is the worker with the NEAR AI check. Its verdicts have the heard words only in a `words` refusal. Before it: 0.14.1, `1e7c6968…8a5c`, from 2026-11-12. | Commit `a4c7b48`; JUDGES.md check 3 builds it | No |
| 0.14.1 and 0.14.1+venice | `1e7c6968…8a5c` and `344b8b47…d3c8`. Still in the project. No caller uses them since 2026-11-14. An `accept` of these versions has the heard words. | Commit `62cd438` | |
| 0.12.0 and 0.13.0 | `bfe81633…c946` and `1b777154…f930`. Removed from the project on 2026-11-12, when no caller used them: the Seams staging server moved to 0.14.1 (`remove_version` txs `2XGQZT5GGJkoVbiCe34VaTZiPkaVDvFxHTLMnhscJVc4` and `3AVPXQTpVkh7cwCvUyDRrN1fdrQ2QyJtSPec53mrWMZB`). A call with one of these keys fails. | Commits `a816798` and `a4d6ce7` | |
| Versions that the Seams staging server calls (a transfer, a note, a rating, a bet) | Since the deploy of 2026-11-14: 0.15.0, `21af4130…27d9`, while NEAR AI Whisper answers, and 0.15.0+venice, `5f475dd2…fcdf`, while it is down. The server checks NEAR AI once a minute and selects the build by `version_key`; the page cannot select it. The TDX quote check accepts only the hash of the build that the server called. | `seams-monorepo` `deployment/wallet-system/targets.json` (`versionKey`, `veniceVersionKey`), commit `d0c481ae` | No |
| Versions that the demo route `/api/voice-verify` calls (the multisig page) | Since the deploy of 2026-11-14: 0.15.0 while NEAR AI Whisper answers, and 0.15.0+venice while it is down. The route checks Whisper before each call, and a request can name the service. The answer names it in the header `X-Speech-To-Text`. | `demo/frontend/functions/api/voice-verify.ts` | No |
| Verdict key | `ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U`, bound to the project, so every version signs with it | `crates/voice-verifier/manifest/outlayer.json` | No |
| HTTPS API and secrets | `https://testnet-api.outlayer.ai/call/seams-v1.testnet/voice-verifier`, with `secrets_ref` `{"profile":"main","account_id":"cyan-loong.testnet"}` | `crates/voice-verifier/README.md` | No |
| Worker with the NEAR AI check | 0.15.0, `21af4130…27d9` (495,848 bytes), added on 2026-11-14, **active**. Both the Seams staging server and the demo route select it while NEAR AI Whisper answers. On 2026-11-14 one `verify` call on it gave an `accept` with `"heard":null`, and one gave a `words` refusal with the heard words. Its quote check is the check of 0.14.1, which was verified live on OutLayer with both cached (`tee_cached` 1) and fresh (`tee_cached` 0) quote checks: see [trust-chain.md](trust-chain.md#the-near-ai-check). | Commit `a4c7b48` | No |
| Worker for a NEAR AI Whisper outage (the `venice` build) | 0.15.0+venice, `5f475dd2…fcdf` (400,341 bytes), added on 2026-11-14, **not active**. The demo route selects it by its key while NEAR AI Whisper is down. It sends the recording to Venice AI over TLS, with no TEE check. On 2026-11-14 one `verify` call on it gave an `accept` with `"heard":null`, and one gave a `words` refusal. On 2026-11-12 two real recordings passed through 0.14.1+venice, the build before it: [the live multisig run](../demo/contracts/voice-multisig/README.md#live-run-on-testnet). | Commit `a4c7b48`, `./build.sh --venice --docker` | No |
| The verifier source on `dev` | 0.15.0: both of its builds are on OutLayer. The default build is active. | Commit `a4c7b48` | No |
| Builds that were removed | 0.14.0+venice, `59ee371c…fa66` (Venice AI answered 422 to each request), 0.14.0 with `dcap-qvl`, `2f8e75a3…7ffb5` (it loaded about 1 s slower), and 0.14.0, `b9a315b7…9293` (the same worker as 0.14.1, before the `venice` fix). Removed from the project on 2026-11-12 (`remove_version` txs `8qEVS3jc68r8WAaVGGoP7NpWp2etexeiwsw8GBMTBxX`, `Akuxz76BL6H9CRZWEsR525dfYv3Um2SoFTcPtYUBGV9E` and `GCQXS8oMUiastKAv6u4cyrMBiK1w9huVpTvRtJZgGku9`). A call with one of these keys fails. | Commits `454c76e` and `6f0d43f` | |

```bash
view outlayer.testnet get_project '{"project_id":"seams-v1.testnet/voice-verifier"}' | jq -r .active_version
```

The project has four versions: 0.15.0, 0.15.0+venice, 0.14.1 and
0.14.1+venice. No caller uses the two 0.14.1 builds. On 2026-11-12 the
owner removed the 27 other versions, when no caller used them. A call with the key of a removed version fails. The history of each
version and the transaction of each removal are in
[`crates/voice-verifier/README.md`](../crates/voice-verifier/README.md#versions).

```bash
# See: 4
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
| Wallet SDK | `@seams/wallet` 0.70.6 on `staging.sign.seams.sh`, `test.sign.seams.sh` and `sign.seams.sh` since 2026-11-13 (`/wallet-assets.manifest.json` of each origin) | Pinned in `demo/frontend/package.json`; source [`seams-wallet` at 0.70.6](https://github.com/seams-tech/seams-wallet/tree/66d831e007dd4d5faee6c189251d2d1463e2eebc) |
| Seams verify route | Live on the Seams staging server since 2026-11-12 (Seams Wallet 0.70.0, `seams-wallet` `35649a05b`) | `speakToSignAttestation.ts` checks the TDX quote of each verifier call against the WASM hash of the build that the server called. See [trust-chain.md](trust-chain.md), link 2. |
| Demo site | https://speak-to-sign.pages.dev, deployed on 2026-11-14 from `dev` at commit `a4c7b48` (Pages deployment `6714c0ef`). It pins the Wallet SDK 0.70.6 | Voice commands press the Wallet card's "Try again", Back, Minimize and Close; they need a Wallet host at 0.70.6, and the row above names the host's version. It has the spoken multisig page `/multisig/`, and the route that selects NEAR AI or Venice AI for each voice check. The multisig page does not offer to send a `words` refusal to the contract, because that verdict holds the heard words. Its posts timeline shows only posts about science, technology, business and politics. Check: `curl -s https://speak-to-sign.pages.dev/api/near-ai-status` gives the state of NEAR AI and of its Whisper. |
