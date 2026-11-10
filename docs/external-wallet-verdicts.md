# Speak-to-Sign with an external NEAR wallet: plan

Status: dropped, 2026-11-10. The owner decided not to build this. The plan
below stays as a record. Nothing is built, deployed or changed.
Scope: Meteor first, through the Seams external NEAR connector
(`@seams/wallet/external-near`, SDK 0.64.0).

## Decision (2026-11-10)

Do not build Speak-to-Sign for Meteor or for other external wallets.
"Speak = sign" works only with a programmable wallet, such as the Seams
Wallet.

Reasons:

- **Approval for each note** (the plan below): Meteor asks for a click
  after each voice check. For notes, the voice adds friction and no value,
  because the click already shows the owner's intent.
- **Relayer form**: the contract accepts the verdict as the authorization,
  and a relayer sends the call. There is no click for each note, but the
  voice is the only check, so a remote replay works:
  - The verifier blocks only a clip with the same bytes. A re-encoded
    recording passes.
  - The rating sentence does not name the note. One recording of "this
    note is helpful" can rate any note as the owner.
  - The Seams path blocks this. Wallet core accepts only audio that it
    recorded in this flow, and the verify route needs the owner's Wallet
    Session.
- **Relayer form with a session**: one Meteor "sign message" popup on each
  visit adds a device factor. With the connect and enrollment popups, that
  is too many Meteor popups. Meteor is not programmable, so it cannot
  combine the voice step and its approval.

A later option, not planned: a function-call key that the page holds, as
older NEAR dApps did at sign-in. Meteor approves it once. The page then
signs each call that carries a verdict, and the contract requires both
that key and the voice. The Seams connector cannot add a key today
(`connect` takes only the network, and the actions are only transfers and
function calls). So this option needs a seams-wallet change and an SDK
release.

## Result

The concept works with no change to seams-wallet for the hackathon version.

- The owner records in the app page. The demo already does this for the
  voice multisig (`demo/frontend/src/multisig/recorder.ts`).
- The page sends the clip to the demo's own verify route,
  `/api/voice-verify` (`demo/frontend/functions/api/voice-verify.ts`). That
  route already calls the OutLayer verifier with no Seams Wallet Session.
- The notes contract checks the signed verdict on chain. The voice
  multisig contract already does this (`demo/contracts/voice-multisig/src/verdict.rs`).
- Meteor signs one ordinary function call that carries the verdict. The
  connector in SDK 0.64.0 already sends function calls and signs NEP-413
  messages.

All new code lives in this repository. The seams-wallet change for the
hackathon is zero files. A production version can move the admission into
the Seams gateway. That change is small and stays in one server folder (see
"Verdict").

With an external wallet, "speak = sign" does not hold. Meteor holds the key
and always shows its own approval. The flow is "speak, then one Meteor
approval". The voice is a second factor that the contract checks. It does
not replace the approval.

## Facts checked for this plan

| Fact | Source | Result |
| --- | --- | --- |
| Wallet core checks the verdict and signs with no confirm; the co-signer checks it again | seams-wallet `packages/wallet/src/core/transactionFeatures/hostOperations.ts` (`signWithVerdict`), `voiceVerdict.ts`, `packages/wallet-server/src/router/domains/speakToSign/voiceVerdictTransaction.ts` | Confirmed |
| Wallet core also checks that the verdict's `audio_digest` is a clip of this flow | `checkVoiceVerdict` in `voiceVerdict.ts` | Confirmed. A contract cannot do this check. |
| The Seams verify route admits only a Wallet Session bearer, and checks `input.owner` against the session's NEAR account | `speakToSignVerify.ts` (`authenticate`, `sessionNearAccount`) | Confirmed. It passes the verifier input through and reads only `owner`. |
| The Seams gateway wires no rate limit on that route | `packages/wallet-server/src/hosted-wallet-gateway.ts`, lines 798-802 | Confirmed. `rateLimit` is optional and not passed. |
| The Speak-to-Sign iframe flow needs a Seams wallet with VoiceID on | `packages/wallet/src/SeamsWeb/walletIframe/host/handlers/speakToSign.ts` (`prepareFlow`) | Confirmed: wallet id, VoiceID `enabled`, session, operation credential |
| The external connector runs in the app document with no iframe, session or co-signer | `apps/docs/src/guides/external-near-wallets.md` | Confirmed |
| Meteor `signMessage` returns a valid NEP-413 signature from a full-access key | seams-wallet `docs/evidence/meteor-message-signing-20261026.md` | Confirmed on testnet, 2026-10-26, account `cyan-loong.testnet`, recipient `localhost:4286` |
| SDK 0.64.0, which has the connector, is on npm | `npm view @seams/wallet dist-tags` | Not yet. `latest` is 0.63.0 on 2026-11-10. Another session runs the release. |
| The demo already records in the page and has its own verify route | `demo/frontend/src/multisig/`, `demo/frontend/functions/api/voice-verify.ts` | Confirmed. The route takes only `verify` with `multisig_propose` now. It uses the Seams staging OutLayer payment key, project and secrets profile. |
| The verifier accepts `community_note` and `note_rating` requests for any contract | `crates/voice-verifier/src/input.rs`, `src/ops/request.rs` | Confirmed. No verifier change is necessary. |
| Notes never step up | `crates/voice-verifier/src/policy.rs` | Confirmed. Only a transfer above 10 NEAR steps up. |
| Enrollment needs a NEP-413 signature from a full-access key of the owner | `crates/voice-verifier/src/ops/enroll.rs`, `src/authorization.rs` | Confirmed. Message `Speak-to-Sign voice enrollment <digest>`, recipient `seams-v1.testnet/voice-verifier`, no callback URL, then an RPC `view_access_key` check for `FullAccess`. |
| A contract can rebuild request digests with `spoken-intent` | `demo/contracts/voice-multisig/Cargo.toml` and `src/lib.rs` | Confirmed. The multisig contract links the crate. |
| `merge-approvals` is a target contract of the demo | `git show 5ba8943` | No longer. Commit 5ba8943 (2026-11-10) removed it from the demo. `github.seams-v1.testnet` stays on chain. |
| The notes contract state can take new fields | `demo/contracts/community-notes/src/lib.rs` | No. The state uses `Default` with no `#[init]`. A new state field needs a migration. |
| The notes contract can pay for a larger WASM | NEAR RPC `view_account`, 2026-11-10 | Yes. `notes.seams-v1.testnet` has 4.9987 NEAR and uses 169,817 bytes. |

## The flow for a Meteor owner

Enrollment, one time:

1. The owner connects Meteor in the page. The page knows `accountId`.
2. The page records three short sentences.
3. The page computes the enrollment digest:
   `base64url(SHA-256("seams:voice-enrollment:v2" || owner || 0x00 || d1 || d2 || d3))`,
   where each `d` is the SHA-256 of one WAV. The Wallet's
   `enrollmentDigest` in `hostOperations.ts` is the reference.
4. Meteor signs the NEP-413 message
   `Speak-to-Sign voice enrollment <digest>` to
   `seams-v1.testnet/voice-verifier`, with a random 32-byte nonce. This is
   one Meteor approval. It sends no transaction.
5. The page sends `op: "enroll"` to `/api/voice-verify` with the three
   clips and `{ public_key, signature_b64, nonce_b64 }`.
6. The verifier checks the signature and the full-access key, then stores
   the template.

Each note or rating:

1. The page builds the verifier request, for example
   `{ kind: "community_note", contract, post_id, note_sha256_hex, summary }`.
2. The page shows the sentence and records one clip.
3. The page sends `op: "verify"` to `/api/voice-verify`.
4. On `accept`, the page asks Meteor to sign one call:
   `add_note_with_verdict` or `rate_note_with_verdict`, 30 Tgas, deposit 0.
5. The contract checks the verdict, then adds the note or the rating.
6. The page calls `controller.checkOutcome(submission)` and shows the
   result.

The verdict lives 120 s from the verifier's clock. The owner must approve
in Meteor in that time. If not, the contract refuses "expired", and the
owner records again.

## 1. Where the owner records

| Choice | What it gives | What it costs | seams-wallet change |
| --- | --- | --- | --- |
| **A. The app page** (recommended) | Built already (multisig recorder). The verifier, the contract and Meteor keep their checks. | The app hears the audio. The app builds the request and shows the sentence, so the owner trusts the app for the unspoken fields (post id, note text, note id). Meteor's approval shows the call arguments. | None |
| B. The Seams Wallet iframe with no Seams wallet | The sentence shows on the Seams origin. The app does not hear the audio. | A new wallet-less mode in the iframe host: `prepareFlow` needs a wallet, VoiceID, a session and a credential today. A new message type, a new public API, the VoiceID phrase surface without a wallet, and a new server admission. The app still chooses the request and still holds the Meteor result, so the gain is the audio and the origin of the sentence only. | Large: iframe host, client router, public API, VoiceID loading, wallet-server |
| C. A hosted page on the Seams origin (a popup, like Intear) | The same gain as B, with a simpler isolation. | A new page, a popup protocol in the SDK, and a new server admission. | Medium to large |

Choose A. It is the same trust model as any dApp with Meteor: the app shows
the request, and the wallet shows the call. The voice check adds proof that
the owner said these words, bound on chain to the owner and the contract.
Consider B or C only if a product must keep audio away from the app.

## 2. Admission to the verify route

Each verifier run costs OutLayer fees on the Seams staging payment key.
This repository does not record the fee for one run. Measure it from the
payment key balance before and after ten runs.

The route must use the Seams staging payment key, project and secrets
profile. OutLayer derives the verifier's storage cell and its verdict key
from the owner of the payment key. With another key, every verify refuses
`template_missing`, and the contract refuses the verdict key.

### Hackathon version, in `demo/frontend/functions/api/voice-verify.ts`

- Accept `op: "verify"` with the kinds `multisig_propose`,
  `community_note` and `note_rating`.
- Accept `op: "enroll"`. The enroll input already carries the owner's
  NEP-413 signature, and the verifier checks it. The route needs no extra
  proof for enroll.
- For the note kinds, refuse a `contract` other than
  `notes.seams-v1.testnet`. Then the Seams key pays only for this demo.
- Keep the same-origin check. It stops other web pages, not scripts.
- Add a rate limit: 30 verify runs for each owner in each hour, 5 enroll
  runs for each owner in each day, and 60 runs for each client IP in each
  hour. Use a Cloudflare KV namespace with a time-to-live on each counter.
  KV is eventually consistent, so the limit is approximate. That is
  sufficient for a demo. The KV namespace is a deploy step and needs the
  owner's go-ahead.
- If there is no time for KV, ship as the multisig route ships now (no
  limit) and keep the payment key balance small.

A stranger can still call `verify` for any owner. The stranger gets no
accepted verdict without the owner's voice, and the contract needs the
owner's key. The cost is the OutLayer fee, and a stranger can use up one
owner's hourly quota.

### Optional: proof of account control

This stops a stranger who uses up an owner's quota.

1. `GET /api/voice-session` returns a challenge:
   `nonce = HMAC(SESSION_SECRET, minute)`. The route keeps no state.
2. Meteor signs the NEP-413 message `Speak-to-Sign session` with that
   nonce, to the recipient `seams-voice-intents.pages.dev`.
3. `POST /api/voice-session` checks the signature, the nonce window (5
   minutes) and the key (RPC `view_access_key`, any access key). It
   returns a token `HMAC(SESSION_SECRET, owner || expiry)`, valid for 1
   hour.
4. `/api/voice-verify` requires the token for `verify`, and refuses an
   `input.owner` that is not the token's owner.

Cost: one more Meteor approval at sign-in, one more secret, about 120
lines. Cut it for the hackathon.

### Later, in the Seams gateway

If Seams must run this admission for all integrators, the code goes in
seams-wallet `packages/wallet-server/src/router/domains/speakToSign/`:

- `speakToSignVerify.ts`: a second branch in `authenticate`. A request
  with a NEP-413 session token admits the token's NEAR account as the
  owner. About 60 lines.
- A new `externalNearAdmission.ts`: the challenge and token routes, the
  NEP-413 check, and the RPC key check. About 200 lines.
- A rate limit store that the gateway passes as `rateLimit`, keyed by the
  owner account instead of `walletId` (D1 table or Durable Object). About
  80 lines and one migration.
- `hosted-wallet-gateway.ts`: wire the new routes and the limit. About 15
  lines.
- Unit tests in `tests/unit/speakToSignVerify.unit.test.ts` and a new test
  file. About 250 lines.

This change adds a new admission kind to one route. It changes no Wallet
core, iframe, co-signer or client code.

## 3. The contract side

Target: `demo/contracts/community-notes`. Upgrade the code in place on
`notes.seams-v1.testnet`.

### New methods

| Method | Arguments | Rule |
| --- | --- | --- |
| `add_note_with_verdict` | `post_id`, `text`, `summary`, `verdict_json`, `signature_b64` | The checks of `add_note`, then the verdict check. Returns the note id. |
| `rate_note_with_verdict` | `note_id`, `rating`, `verdict_json`, `signature_b64` | The checks of `rate_note`, then the verdict check. |
| `set_verifier_key` | `verifier_public_key` | `#[private]`: only the contract account. For a key rotation. |
| `get_verifier_key` | none | View. `ed25519:<base58>`. |
| `get_note_verdict` | `note_id` | View. The verdict digest (hex) of a note that was added with a verdict, or `null`. |

Keep `add_note` and `rate_note` unchanged. The Seams Wallet path signs
them, and the co-signer rebuilds the request from those method names.
Keep `NoteView` unchanged, so the current page parse does not break.

### How the contract rebuilds the request digest

For `add_note_with_verdict`:

```rust
let request = SpokenRequestV1::CommunityNote {
    network: Network::Testnet,
    owner: near_account(&env::predecessor_account_id()),
    contract: near_account(&env::current_account_id()),
    post_id,
    note_sha256: env::sha256_array(text.as_bytes()),
    summary: SpokenSummary::new(&summary)
        .unwrap_or_else(|_| env::panic_str("the summary is not speakable")),
};
let digest = spoken_intent::request_digest(&request);
verdict::check_verdict(&self.verifier_key(), &digest, &verdict_json, &signature_b64);
```

For `rate_note_with_verdict`, use `SpokenRequestV1::NoteRating` with
`note_id` and the rating mapped to `NoteRatingV1`.

The owner is the predecessor. A verdict of one account cannot serve
another account. A call through another contract has another predecessor,
so the digest does not match.

### The verdict check

Copy `verdict.rs` from the voice multisig (107 lines). It checks the
signature over `SHA-256("seams:outlayer:voice-verdict:v2" || verdict_json)`,
the 13 exact fields, `kind`, outcome `accept`, the expiry and the request
digest. Add one check: refuse an `expires_at_ms` later than
`block_timestamp_ms + 150_000`, as Wallet core does
(`MAX_VERDICT_LIFE_MS`). A `step_up` verdict fails, but notes never step
up.

Do not move `verdict.rs` into a shared crate for the hackathon. That
changes the multisig WASM, so its README code hash no longer matches the
source. Remove the copy after the hackathon.

### Replay protection

- The verifier marks each clip as used (`audio_reused`), so one clip gives
  one verdict.
- The contract marks each verdict as used: it writes the 32-byte verdict
  message hash (the contract computes it for the signature check) under
  the key prefix `verdict:`. A second call with the same verdict fails.
- A replay can only come from the owner, because the owner is in the
  digest. The marker still stops a double note from one verdict.

Storage: about 80 bytes for each marker, about 0.0008 NEAR. The contract
pays, as it does for notes.

### State and upgrade

The state has no `#[init]`, so a new state field needs a migration. Do not
add one. Keep the new data under raw storage keys:

- `verdict:<32 bytes>` for the used verdicts.
- `verifier_key` for the key. If it is absent, use the pinned constant
  `ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U`, the same key as
  `SPEAK_TO_SIGN_VERIFIERS.testnet` in seams-wallet and the multisig
  config.
- `note_verdict:<note id>` for `get_note_verdict`.

The `LookupMap` prefixes of the current state are one borsh enum byte
(0 to 3). The new prefixes start with a letter, so they do not collide.

The unit tests call `set_verifier_key` with the test key, as the multisig
tests do with `new`.

### Key pin and rotation

The verdict key belongs to the OutLayer project and the owner of the
payment key. It stays the same across verifier versions. It changes only
if the project or the payment key owner changes. Then the contract
account calls `set_verifier_key`. For the hackathon, one key is enough. A
production contract can accept the old and the new key for one day.

### Gas and size

- Measured: `add_note` 2.15-2.26 Tgas; multisig `propose` with the same
  verdict check 2.29 Tgas.
- Estimate: 3 to 4 Tgas for each new method. Attach 30 Tgas, as the
  Wallet does now.
- WASM: about 169 KB now. With `spoken-intent` and the verdict check,
  expect about 230 KB (the multisig WASM is 230,376 bytes). The extra
  storage stake is about 0.6 NEAR. The account has 4.9987 NEAR.

### Merge approvals

Commit 5ba8943 removed the merge example and its contract from the demo.
Cut it from this plan. If it comes back, use the same pattern:
`approve_merge_with_verdict` rebuilds `SpokenRequestV1::MergeApproval`
from `env::sha256_array(repo)`, `pull_request`, `SpokenBranch::new(base)`
and the 20 head-commit bytes.

### Tests

- Unit tests: a good verdict, a wrong key, a wrong owner, a wrong contract,
  a changed text, a changed summary, an expired verdict, a verdict too far
  ahead, a reused verdict, a `step_up` verdict, a refusal verdict.
- Sandbox test: deploy the current WASM, add two notes, deploy the new
  WASM, read the notes, then add a note with a verdict.

## 4. SDK and API shape

### Hackathon: no new SDK API

The demo codes only against `NotesSigner` and `SignerSetup` in
`demo/frontend/src/signer/notesSigner.ts`. Add a second implementation:

- `demo/frontend/src/voice/verdict.ts`:
  `requestVerdict({ owner, request, wav })` returns
  `{ kind: "accepted", verdictJson, signatureB64 }`, a refusal or
  `unavailable`. Reuse the reasons in `multisig/voiceVerify.ts`.
- `demo/frontend/src/voice/enroll.ts`:
  `enrollVoice({ owner, clips, signMessage })`. It computes the digest,
  asks Meteor to sign, and calls the route.
- `demo/frontend/src/signer/externalSigner.ts`:
  `createExternalSigner({ controller, connection, contract })`, which
  implements `NotesSigner & SignerSetup`. `requestNote` and
  `requestRating` record, verify and send the call with
  `controller.sendTransaction`, then `controller.checkOutcome`.
- Move `multisig/recorder.ts` and `multisig/wav.ts` to `src/voice/`, so
  both screens use one recorder.

The page needs no seams-wallet internals. The verifier computes the
digests from the request input, and the contract computes them again.
The page computes only SHA-256 of the note text and the enrollment digest
(about 10 lines with WebCrypto).

### The wallet picker

- The sign-in modal shows two choices: "Seams Wallet" (the current
  `HostedSeamsAuthMenu`) and "Meteor".
- The page keeps one explicit source: `"seams"` or `"external"`. The
  active signer is `createSeamsSigner` or `createExternalSigner`. The
  connector guide asks for this explicit source.
- Make one `ExternalNearController` for the page:
  `{ network: "testnet", rpcUrl, wallets: ["meteor"] }`.
- `ExternalNearWalletPicker` disconnects when it unmounts. So do not put
  it in a modal that closes. Use `useExternalNear` and
  `controller.connect("meteor")` in the modal, and keep the controller at
  the page root.
- Copy for the Meteor path: "Say the summary. Then approve in Meteor."
- Meteor owners have their own NEAR, so the faucet step does not apply.

### Later: a package API

If other apps want this, export the page recorder, `requestVerdict` and
`enrollVoice` from `@seams/speak-to-sign` (this repository,
`packages/speak-to-sign`) as a new entry, for example
`@seams/speak-to-sign/external`. It takes the verify route URL and a
`signMessage` function. This needs no seams-wallet change.

Do not add `seams.speakToSign.requestVerdict` to the Seams Wallet for
this. A Meteor owner has no Seams wallet, so the iframe flow cannot serve
them (choice B above).

## 5. Changes by repository

### speak-to-sign (all the hackathon work)

| Item | Files | Size |
| --- | --- | --- |
| Contract methods, verdict check, replay marker, key | `demo/contracts/community-notes/src/lib.rs`, new `src/verdict.rs`, `Cargo.toml` | +90 lines, +107 copied, +1 dependency |
| Contract tests | `src/tests.rs`, `sandbox/` | +200 and +60 lines |
| Contract README (methods, gas, code hash) | `demo/contracts/community-notes/README.md` | +40 lines |
| Verify route: note kinds, enroll, contract pin | `demo/frontend/functions/api/voice-verify.ts` | +60 lines |
| Rate limit | same file, `wrangler.toml` (KV binding) | +50 lines |
| Recorder move | `demo/frontend/src/multisig/recorder.ts`, `wav.ts` to `src/voice/` | 0 net |
| Verdict client, enrollment, external signer | new `src/voice/verdict.ts`, `src/voice/enroll.ts`, `src/signer/externalSigner.ts` | +60, +80, +180 lines |
| Wallet choice | `src/components/SignInModal.tsx`, the page root, `SpeakStep.tsx` copy | +80 lines |
| SDK bump | `demo/frontend/package.json` to `@seams/wallet` 0.64.0 | 3 lines, after the release |
| Page tests | `demo/frontend/tests/` | +150 lines |

### seams-wallet

| Version | Change | Size |
| --- | --- | --- |
| Hackathon | None. It uses only public 0.64.0 APIs: `ExternalNearController` (`connect`, `sendTransaction`, `signMessage`, `checkOutcome`), `useExternalNear`, `functionCall`. | 0 files |
| Production, optional | Admission for external NEAR accounts on `/speak-to-sign/v1/verify` (section 2, "Later") | About 600 lines with tests, in `packages/wallet-server` only |
| Production, optional | A section "Speak-to-Sign with an external wallet" in `apps/docs/src/guides/external-near-wallets.md` and the Japanese copy | About 40 lines each |
| Not recommended | A wallet-less recording mode in the iframe, or a hosted recording page (choices B and C) | Large; touches the iframe host, client, public API, VoiceID and server |

No public API of `@seams/wallet` changes in any recommended item.

## 6. Effort, risks and cuts

### Effort (one person, with agents)

| Step | Days |
| --- | --- |
| Contract: methods, check, marker, unit and sandbox tests, build | 0.75 to 1 |
| Verify route: kinds, enroll, pin, rate limit | 0.25 to 0.5 |
| Page: recorder move, verdict client, enrollment, external signer, picker | 1 to 1.5 |
| SDK 0.64.0 bump, contract upgrade, Pages deploy (each with the owner's go-ahead) | 0.25 |
| Live run with a person, Meteor and a microphone | 0.25 to 0.5 |
| **Total** | **2.5 to 3.5** |

The deadline is 2026-11-14 23:59 UTC, about 4.5 days from this plan. The
work fits only if other demo work leaves 3 days free.

### Risks

| Risk | Effect | Mitigation |
| --- | --- | --- |
| SDK 0.64.0 is not on npm in time | No connector in the demo | Wait for the release. Do not build the connector into the demo from a local link. |
| The owner takes more than 120 s in Meteor | The contract refuses "expired" | Ask Meteor at once after the verdict. Show the time left. Record again on "expired". |
| Meteor refuses the recipient `seams-v1.testnet/voice-verifier` | No enrollment | The live test used `localhost:4286`, so Meteor accepts a non-account recipient. Test the real recipient first, on day 1. |
| A Meteor account signs with a key that is not full access | The verifier refuses enroll | The live test showed `FullAccess`. Show the verifier's `function_call_key` detail in plain words. |
| Meteor shows the long `verdict_json` argument | A cluttered approval screen | Accept it for the demo. |
| A public route spends the Seams payment key | OutLayer fees | Contract pin, rate limit, small balance |
| The in-place upgrade breaks the state | Notes are lost | No new state fields; the sandbox upgrade test; a few notes on chain only |
| The picker unmounts and disconnects | The signer loses its connection | Keep the controller at the page root; use `useExternalNear` |
| The app page hears the audio | Less privacy than the Seams iframe | Already true for the multisig. Say so on the page. |
| Other sessions edit `demo/frontend` | Merge conflicts | Agree the files with the demo page session first |

### Cut for the hackathon

- Merge approvals (already removed from the demo).
- HOT and Intear. They have no `signMessage` in the connector, and HOT has
  no testnet path.
- The proof of account control for the route.
- A shared verdict crate. Copy `verdict.rs`.
- Old and new keys at the same time. One key, with `set_verifier_key`.
- The Seams gateway admission, the iframe mode and the hosted page.
- The package entry in `@seams/speak-to-sign`.

If time is short, build ratings first. A rating has no free text, so its
page and tests are smaller. Enrollment is not optional: a Meteor owner
has no other way to enroll.

## Open questions for the owner

1. The Seams staging payment key pays for Meteor owners' verifier runs.
   Is that acceptable for the demo?
2. May the demo route get a KV namespace for the rate limit?
3. Upgrade `notes.seams-v1.testnet` in place, or deploy a new account?
   This plan recommends in place.

## Verdict

**Small seams-wallet change (list).**

- Hackathon version: no seams-wallet change. The work is in this
  repository: the notes contract, the demo verify route and the demo
  page. It needs only the published SDK 0.64.0.
- Production version, optional: one new admission kind for external NEAR
  accounts on `/speak-to-sign/v1/verify`, in
  `packages/wallet-server/src/router/domains/speakToSign/` and the
  gateway wiring. About 600 lines with tests. No Wallet core, iframe,
  co-signer or public API change.
- Production version, optional: about 40 lines of docs in the external
  NEAR wallets guide.

Reasons: the verifier already serves any contract, and the voice multisig
already proves both halves of the pattern (a page recorder with a route
that needs no Wallet Session, and an on-chain verdict check). The
connector already sends function calls and signs NEP-413 messages with
Meteor.

The one architectural item is a recording surface on the Seams origin for
owners with no Seams wallet (choices B and C). Reconsider it only if a
product must keep audio away from the app. The plan does not need it.

Effort for the hackathon version: 2.5 to 3.5 days.
