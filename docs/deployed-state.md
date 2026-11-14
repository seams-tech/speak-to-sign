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
| Active version on OutLayer (a call with no `version_key`) | 0.15.0, `21af4130…27d9`, since 2026-11-14 (`set_active_version` tx `859jnFSeuLjfaDns57EnmA1DVZQJrXC3tV81asdjFS8Z`). It is the worker with the NEAR AI check. Its verdicts have the heard words only in a `words` refusal. | Commit `a4c7b48`; JUDGES.md check 3 builds it | No |
| Versions that the Seams staging server calls (a transfer, a note, a rating, a bet) | Since the deploy of 2026-11-14: 0.15.0, `21af4130…27d9`, while NEAR AI Whisper answers, and 0.15.0+venice, `5f475dd2…fcdf`, while it is down. The server checks NEAR AI once a minute and selects the build by `version_key`; the page cannot select it. The TDX quote check accepts only the hash of the build that the server called. | `seams-monorepo` `deployment/wallet-system/targets.json` (`versionKey`, `veniceVersionKey`), commit `d0c481ae` | No |
| Versions that the demo route `/api/voice-verify` calls (the multisig page) | Since the deploy of 2026-11-14: 0.15.0 while NEAR AI Whisper answers, and 0.15.0+venice while it is down. The route checks Whisper before each call, and a request can name the service. The answer names it in the header `X-Speech-To-Text`. | `demo/frontend/functions/api/voice-verify.ts` | No |
| Verdict key | `ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U`, bound to the project, so every version signs with it | `crates/voice-verifier/manifest/outlayer.json` | No |
| HTTPS API and secrets | `https://testnet-api.outlayer.ai/call/seams-v1.testnet/voice-verifier`, with `secrets_ref` `{"profile":"main","account_id":"cyan-loong.testnet"}` | `crates/voice-verifier/README.md` | No |
| Worker with the NEAR AI check | 0.15.0, `21af4130…27d9` (495,848 bytes), added on 2026-11-14, **active**. Both the Seams staging server and the demo route select it while NEAR AI Whisper answers. On 2026-11-14 one `verify` call on it gave an `accept` with `"heard":null`, and one gave a `words` refusal with the heard words. On the same day, the two verdicts of [the live multisig run](../demo/contracts/voice-multisig/README.md#live-run-on-testnet) came from it. Each of these calls passed the check of the NEAR AI quotes: a failed check refuses with `transcriber_not_attested`. See [trust-chain.md](trust-chain.md#the-near-ai-check). | Commit `a4c7b48` | No |
| Worker for a NEAR AI Whisper outage (the `venice` build) | 0.15.0+venice, `5f475dd2…fcdf` (400,341 bytes), added on 2026-11-14, **not active**. The demo route selects it by its key while NEAR AI Whisper is down. It sends the recording to Venice AI over TLS, with no TEE check. On 2026-11-14 one `verify` call on it gave an `accept` with `"heard":null`, and one gave a `words` refusal. | Commit `a4c7b48`, `./build.sh --venice --docker` | No |
| The verifier source on `dev` | 0.15.0: both of its builds are on OutLayer. The default build is active. | Commit `a4c7b48` | No |

```bash
view outlayer.testnet get_project '{"project_id":"seams-v1.testnet/voice-verifier"}' | jq -r .active_version
```

The callers use two builds: 0.15.0 and 0.15.0+venice. The project also
holds the two builds of 0.14.1, which no caller uses.

```bash
# See: 4
view outlayer.testnet get_version_count '{"project_id":"seams-v1.testnet/voice-verifier"}'
```

## The contracts

| Account | Live code hash | Source build | Voice check on chain |
| --- | --- | --- | --- |
| `notes.seams-v1.testnet` | `724jz1XP…btU7c` = SHA-256 `596beeb3…d9c3`, the build of commit `119ef0e` | The same | **Yes.** `get_voice_config` returns `"required":true`. |
| `pm-notes.seams-v1.testnet` | `7qA3mFHg…nQ9Z` = `657c3b07…`, the build of commit `777b844` | The same | **Yes.** `get_voice_config` returns `"required":true`. |
| `voice-multisig-3.seams-v1.testnet` | `CkYrt1XM…QTnA` = `ae988e20…`, the build of commit `99231f6` (version 3.0.0). Deployed on 2026-11-14 (create tx `AUsJCRrhgGCutsUFMJw1nbFDf7HmkPaVJ57qiGhi6kYH`, deploy and `new` tx `vnhv55JXYutq9iu4namXP3tzGSVTDLT9zgGokogd75m`). SourceScan verified it. The contract's `reproducible.sha256` names the 3.1.0 build of the global code; [the contract README](../demo/contracts/voice-multisig/README.md#reproducible-build) has both builds. | The same | **Yes.** Each `propose` and `approve` needs a verdict. It has 2 of 2 signers, and it is the multisig of the demo page `/multisig/` and the moderator of the notes contract. Proposal 1 ran on 2026-11-14 with verifier 0.15.0: `propose`, `approve` and `execute` of 0.1 NEAR to `bob.testnet`. Both verdicts have `"heard":null`. See [the live run](../demo/contracts/voice-multisig/README.md#live-run-on-testnet). |
| `voice-multisig-factory.seams-v1.testnet` | `JBt7zAY8…DjpK` = `ff6049b4…`, the build of commit `ad9b9d8` (version 1.0.0). Deployed on 2026-11-14 (create tx `J6ABP9zGKjpnZUAhCR48ro48Znw6Nxm4Mv8ZA1eheatK`, deploy and `new` tx `687iHX1iqYUjjmuWM8fm7mLkakoAaSLNwfRcmSFs53M3`). SourceScan verified it. | The same | No voice step: it creates a voice multisig for a visitor of `/multisig/`, the account `m<N>.voice-multisig-factory.seams-v1.testnet`. Its `get_config` names the global code and the verifier key. See [the factory README](../demo/contracts/voice-multisig-factory/README.md). |
| Each `m<N>.voice-multisig-factory.seams-v1.testnet` | No code of its own. It uses the global code `3cUt9ft8…KErX` = `26ce3a73…`, the build of voice-multisig 3.1.0 at commit `ad9b9d8` (global deploy tx `GYb8gPmbrNnXeE9K86rMzKkNP9zdeeMGXZrqRs8MUQBt`, 2026-11-14). SourceScan verified this code for `m1`. | The same | **Yes**, as `voice-multisig-3`. The account has no access key. `m1` is a test with one signer, `seams-v1.testnet` (create tx `CtseRyUxxtt3Vy2fxLGH1Wyj5nAH5qbi8RVCfPRFCpnq`). |
| `seams-faucet.testnet` | `6d8BGwTR…fR2z` = `538b7580…`, the build of commit `777b844` | The same | No voice step (it is the faucet). |

```bash
for a in notes.seams-v1.testnet pm-notes.seams-v1.testnet voice-multisig-3.seams-v1.testnet seams-faucet.testnet; do echo "$a $(code_hash $a)"; done
view notes.seams-v1.testnet get_voice_config '{}'
view pm-notes.seams-v1.testnet get_voice_config '{}'
view notes.seams-v1.testnet get_moderator '{}'
# See: the code hash 3cUt9ft8…KErX of the global voice-multisig code.
view voice-multisig-factory.seams-v1.testnet get_config '{}'
```

The moderator of the notes contract is `voice-multisig-3.seams-v1.testnet` (since 2026-11-14, `set_moderator` tx `9iJaF51uf1TXQM9ZBA3JP76NNTigvKe597N3xsW7d3fC`).

## The Wallet and the site

| Item | Live | Notes |
| --- | --- | --- |
| Wallet SDK | `@seams/wallet` 0.72.0 on `staging.sign.seams.sh`, `test.sign.seams.sh` and `sign.seams.sh` since 2026-11-14 (`/wallet-assets.manifest.json` of each origin). A wallet with no VoiceID can set up its voice from a page, and one unlock gives 5 signatures | Pinned in `demo/frontend/package.json`; source [`seams-wallet` at 0.72.0](https://github.com/seams-tech/seams-wallet/tree/754d03f02523e79358f755fb3969afce430dc259) |
| Seams verify route | Live on the Seams staging server since 2026-11-12 (`seams-wallet` `35649a05b`) | `speakToSignAttestation.ts` checks the TDX quote of each verifier call against the WASM hash of the build that the server called. See [trust-chain.md](trust-chain.md), link 2. |
| Demo site | https://speak-to-sign.pages.dev, deployed on 2026-11-14 (15:54 UTC) from `dev` at commit `91d47a3` (Pages deployment `eff527fc`). It pins the Wallet SDK 0.72.0 | Voice commands press the Wallet card's "Try again", Back, Minimize and Close; they need a Wallet host at 0.72.0, and the row above names the host's version. It has the spoken multisig page `/multisig/`, which shows `voice-multisig-3.seams-v1.testnet` first and has the form "Create your own multisig" for the factory `voice-multisig-factory.seams-v1.testnet` and the list "Your multisigs" for a signed-in wallet, and the route that selects NEAR AI or Venice AI for each voice check. The multisig page does not offer to send a `words` refusal to the contract, because that verdict holds the heard words. Its posts timeline shows only posts about science, technology, business and politics. Its faucet gives a new account 0.3 NEAR and 2 USDC, as `get_config` of `seams-faucet.testnet` sets. Check: `curl -s https://speak-to-sign.pages.dev/api/near-ai-status` gives the state of NEAR AI and of its Whisper. |
