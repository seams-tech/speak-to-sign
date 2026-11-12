# Voice intents: specification

A voice intent is one typed request that the owner of a NEAR account approves
with their own voice. The owner says one fixed English sentence. An attested
verifier checks the speaker and the words, and signs a verdict. The verdict
binds the voice and the words to one exact request. The Wallet, or a
contract, signs or runs the request only with a valid verdict for it.

This document is the specification. The diagrams are in
[`architecture.md`](architecture.md). Testnet only.

## 1. Terms

| Term | Meaning |
| --- | --- |
| Owner | The NEAR account that approves. The sentence does not say it. |
| Request | A typed value, `SpokenRequestV1`. It holds every field that the verdict binds. |
| Sentence | The one canonical English text of a request. `render` makes it. |
| Spoken words | The lowercase words of the sentence, as the owner says them. |
| Template | The owner's stored speaker embedding, made at enrollment. |
| Verifier | The OutLayer TEE worker `seams-v1.testnet/voice-verifier`. |
| Verdict | The JSON object that the verifier signs. Its outcome is `accept`, `step_up` or `refuse`. |
| Near miss | A sentence that is close to the expected sentence but means another thing. |

## 2. Parts

| Part | Where | Job |
| --- | --- | --- |
| `spoken-intent` | `crates/spoken-intent/` | Renders a request to its sentence, computes the digests, and reads transcripts. `no_std`, with no floats, clock or randomness. |
| Verifier | `crates/voice-verifier/` | The operations `enroll` and `verify` (also `select`, `transcribe`, `detect` and `audio_key`). It keeps the templates and signs the verdicts. |
| Speaker service | `crates/speaker-service/` | ReDimNet B1 in a Phala dstack CVM. It returns a signed speaker embedding. It gives no verdict. |
| Plugin | `seams-wallet`: `packages/wallet/src/core/transactionFeatures/approver/` | The approver, a part of `@seams/wallet` that loads on first use (before refactor 232: `@seams/wallet-voice-sign`; until 0.66.0: `@seams/speak-to-sign`). It runs the prompts and the cards. It holds no key. |
| Wallet core | `seams-wallet` | Records the audio, checks the verdict against a pinned key, and signs the one transaction. |
| Contracts | `demo/contracts/` | The targets of the requests. The voice multisig and the note market also check the verdict on chain. |

## 3. Requests

`SpokenRequestV1` is a Borsh enum with explicit tags. Tag 0 is retired and
decoding refuses it. Tag 3 is reserved.

| Tag | Kind | Verifier `kind` | The owner says | Bound but not said |
| --- | --- | --- | --- | --- |
| 1 | `MultisigApproval` | `multisig_propose`, `multisig_hide_note`, `multisig_confirm` | "approve proposal seven send twenty five near to grants dot testnet" | network, owner, multisig, the salted commitment |
| 2 | `AccountTransfer` | `transfer` | "send twenty five near to grants dot testnet" | network, owner |
| 4 | `CommunityNote` | `community_note` | the summary of the note, 1 to 12 words | network, owner, contract, post id, SHA-256 of the note text |
| 5 | `NoteRating` | `note_rating` | "this note is helpful", "this note is somewhat helpful" or "this note is not helpful" | network, owner, contract, note id |
| 6 | `MergeApproval` | `merge_approval` | "merge pull request forty two into main" | network, owner, contract, SHA-256 of the repository name, head commit |

Later tags, with their own sections in `crates/voice-verifier/README.md`:
7 `MarketBet`, 8 `Transaction`, 9 `SignedMessage` and 10 `Confirmation`.
Tag 10 is for an application owner (`app:<id>`) and has no network and no
NEAR account: `{owner, context, payload_sha256, summary}`. The operation
`select` takes 2 to 16 candidate requests and signs a verdict for the one
that the owner said. The plan for use with no wallet is in
[`standalone-library.md`](standalone-library.md).

The types hold the grammar rules, so `render` cannot fail:

- `SpokenAccount`: a named NEAR account that the text can say. It is not an
  implicit account (64 hex characters) and not a `0x` account.
- `NearAmount`: an exact multiple of 0.01 NEAR, from 0.01 to 1,000,000 NEAR.
  The crate never rounds.
- `SpokenSummary`: 1 to 12 words of ASCII letters.
- `SpokenBranch`: one word of 1 to 32 lowercase ASCII letters.

## 4. Sentence and digests

`render(request)` gives three values:

- `display_text`: the sentence that the confirm screen shows, for example
  "Send 25 NEAR to grants.testnet".
- `spoken`: the words that the owner says, as tokens.
- `spoken_text`: the tokens, joined with single spaces.

The spoken form spells each separator of an account name: "." is "dot", "-"
is "dash" and "_" is "underscore". A decimal amount uses "point": 0.01 is
"zero point zero one".

The renderer version is `spoken-intent/1`. A change to any rendered text is
a new renderer version.

| Digest | Formula |
| --- | --- |
| `request_digest` | `SHA-256("seams:spoken-intent:request:v1" \|\| borsh(request))` |
| `spoken_text_digest` | `SHA-256("seams:spoken-intent:spoken:v1" \|\| spoken_text)` |
| `audio_digest` | `SHA-256(canonical WAV)` |
| `multisig_commitment` | `SHA-256("seams:spoken-intent:multisig-commitment:v1" \|\| borsh(multisig, proposal_id, proposal) \|\| salt)` |
| `request_digest` of tag 1 | `SHA-256("seams:spoken-intent:request:v1" \|\| borsh(1u8, network, owner, multisig, proposal_id, commitment))` |

A verdict writes each digest as base64url text with no padding.

The digest of a multisig approval holds the commitment, not the proposal. So
the contract computes it from its own state, and the chain does not show the
proposal.

`crates/spoken-intent/fixtures/spoken_intent_vectors_v1.json` is the golden
file. The Wallet has a TypeScript port of the rules, and its tests read this
file. A test in the crate fails if the file differs from what the code
generates.

## 5. Audio

- The input is a WAV: 16 kHz, mono, PCM16, at most 8 s, in standard base64.
- The verifier writes it again with a plain 44-byte header. This is the
  canonical WAV. A header change does not make a new audio digest.
- The energy gate refuses audio with reason `quality`:
  - A frame is 512 samples (32 ms). A frame is voiced at an RMS of 0.006 or
    more.
  - The audio needs at least 600 ms of voiced frames.
  - At most 1% of the samples can be at full scale.
- Each recording passes one time. The verifier writes the mark
  `audio:v2:<audio digest>` with one atomic set-if-absent. A second use
  refuses with `audio_reused`. A refusal after the mark also uses up the
  recording, so the Wallet records new audio for each try.

### 5.1 Sealed audio

A Wallet can seal each recording to the verifier, so that the Seams server
and OutLayer's coordinator carry only ciphertext. The verifier opens the
recording inside its TEE. Verifier 0.12.0 and later. The diagram of the path
is section 9 of [`architecture.md`](architecture.md#9-confidential-audio).

- **Key.** The audio key is an X25519 key pair. The private key is the
  OutLayer secret `PROTECTED_AUDIO_KEY`: 32 bytes that the keystore made
  inside its TEE (type `hex32`). The keystore refuses a manual value with the
  `PROTECTED_` prefix, so nobody saw the private key.
- **Envelope.** HPKE base mode (RFC 9180) with DHKEM(X25519, HKDF-SHA256),
  HKDF-SHA256 and ChaCha20-Poly1305. `info` is `seams:voice-audio:v1`. The `aad` is
  `op || 0x00 || owner`, with `op` the name of the operation (`verify`,
  `enroll`, `select`, `transcribe` or `detect`).
- **Wire.** A sealed clip is `enc || ciphertext || tag` (32 bytes, the WAV,
  16 bytes) in standard base64. It goes in `audio_sealed_b64` and takes the
  place of `audio_wav_b64`. An input has one of the two fields.
- **Key answer.** The operation `{"op":"audio_key"}` returns
  `audio_public_key_b64`, `signature_b64` and `public_key`. The verdict key
  signs `SHA-256("seams:outlayer:voice-audio-key:v1" || audio public key)`.
  A Wallet takes the audio key only if the verdict key that it pins made the
  signature. So a server between them cannot put its own key there.
- **Refusals.** A clip that does not open refuses with `audio_invalid`: it
  was sealed to another key, for another owner or operation, or it was
  changed. Sealed audio on a project without the secret refuses with
  `unsupported`.
- **Unchanged.** The audio digest, the used-audio mark and the enrollment
  digest are over the canonical WAV of the opened clip. A sealed clip and a
  plain clip of the same WAV are the same audio.

Sealed audio hides the recording on the path. It does not hide the request:
the Wallet sends `request` in plain text, and the verdict names what was
heard.

## 6. Enrollment (`enroll`)

Input: `{"op":"enroll","owner","audio_wav_b64":[3 WAVs],"authorization":{"public_key","signature_b64","nonce_b64"}}`.

1. The owner records three clips.
2. The Wallet signs one NEP-413 message with a full-access key of the owner:
   - `enrollment_digest = base64url(SHA-256("seams:voice-enrollment:v2" || owner || 0x00 || d1 || d2 || d3))`.
     `d1` to `d3` are the audio digests of the three canonical WAVs.
   - `message = "Speak-to-Sign voice enrollment " + enrollment_digest`.
   - `recipient = "seams-v1.testnet/voice-verifier"`.
3. The verifier computes the digest from the audio that it received. It
   checks the signature before any network call.
4. The verifier reads `view_access_key(owner, public_key)` over NEAR RPC. A
   function-call key or an unknown key refuses with `not_authorized`.
5. The speaker service returns one embedding for each clip. Every pair of
   embeddings must reach the speaker cutoff (cosine 0.45 or more).
6. The template is the unit mean of the three embeddings. The verifier
   stores it at `template:v3:<owner>`, encrypted by the OutLayer keystore.
7. A new enrollment with a new authorization replaces the template and adds
   1 to its epoch.

The output kind is `seams_voice_enrollment_v3`.

## 7. Verification (`verify`)

Input: `{"op":"verify","owner","request":{"kind",...},"contacts":[...],"audio_wav_b64"}`.

- `contacts` holds at most 32 named accounts that the owner knows.
- The verifier refuses unknown fields at every level.

The checks run in this order. A refusal keeps the verdict fields from the
checks before it.

1. **Request.** Build the typed request, render it, and compute
   `request_digest` and `spoken_text_digest`.
2. **Audio.** Decode the WAV, compute `audio_digest`, and run the energy
   gate.
3. **Calls.** Send the canonical WAV to the speaker service and to NEAR AI
   Whisper (`openai/whisper-large-v3`, English) at the same time.
4. **Storage.** While the calls are in flight, read the template and write
   the used-audio mark.
5. **Speaker.** Check the signed reply of the speaker service (section 7.1).
   Compare the embedding with the template. A cosine below 0.45 refuses with
   `speaker`.
6. **Words.** Read the transcript with `normalize_punctuated`. The heard
   tokens must equal the rendered tokens (section 7.2). If not, refuse with
   `words`.
7. **Policy.** `policy::decide` can only change an accept to a `step_up`
   (section 7.3).
8. **Sign.** Set the expiry and sign the verdict (section 8).

### 7.1 Speaker reply

The verifier sends a fresh 32-byte nonce with the audio. The service signs
`SHA-256("seams:speaker-embedding:v1" || audio_digest || nonce || model_sha256 || embedding bytes)`.
The verifier checks:

- the signature, against the pinned service key;
- the nonce and the audio digest of this call;
- the model digest of ReDimNet B1;
- the embedding: 192 finite `f32` values.

The pinned key comes from the attestation of the service. The TDX
`report_data` is `SHA-256("seams:speaker-service:v1" || public_key || model_sha256)`.

### 7.2 Word check

The default rule is exact: the heard tokens equal the rendered tokens. A
rating, a merge approval and a multisig confirmation always need the exact
words.

Two kinds of forgiveness exist. Each one applies only to words that hold no
value.

- **Send sentence** (also the send part of a multisig proposal):
  - "sent" or "sends" as the first word counts as "send".
  - A closed list of sound-alikes counts as "near" or "testnet".
  - A number sound-alike counts as the number word in the amount slot.
  - "point" counts as "dot". "dash" can be left out.
  - A receiver that is one sound from a known account counts as that
    account. The known accounts are the receiver and the contacts.
  - The amount and the receiver are still compared with the request.
- **Note summary** of 4 words or more: one word changed or dropped passes,
  if the heard words are still closer to the summary than to every near
  miss.

The near misses come from `confusion_set(request, contacts)`. They include
these changes: another amount (10 times, one tenth, one digit changed),
another known receiver, another verb, a negation, a dropped clause and an
added clause. The verifier never accepts a near miss. An added or dropped
"not" never passes.

`word_margin_milli` in the verdict is
`(distance to the closest near miss - distance to the expected words) * 1000 / expected word count`.
The distances are word edit distances.

### 7.3 Policy step

The step runs after the speaker and the words pass. Today it has one fixed
rule:

| Rule id | Text |
| --- | --- |
| `stub_voice_amount_above_10_near` | A voice payment above 10 NEAR needs a passkey. |

Exactly 10 NEAR is allowed. On a `step_up`, the Wallet also asks for a fresh
passkey approval.

## 8. Verdict

`verify` returns
`{"kind":"seams_voice_verify_output_v2","verdict_json","signature_b64","public_key","policy_text","ms","detail"}`.
The output stays below 1,024 bytes.

`verdict_json` is the only signed object. It is compact JSON with these 13
fields, all present, in this order:

| # | Field | Value |
| --- | --- | --- |
| 1 | `kind` | `seams_voice_signed_verdict_v2` |
| 2 | `renderer` | `spoken-intent/1` |
| 3 | `verifier` | The verifier version, for example `0.7.0` |
| 4 | `request_digest` | Section 4 |
| 5 | `spoken_text_digest` | Section 4 |
| 6 | `audio_digest` | Section 4 |
| 7 | `outcome` | `accept`, `step_up` or `refuse` |
| 8 | `reason` | Only on `refuse` (section 8.1) |
| 9 | `policy_rule` | The rule id, only on `step_up` |
| 10 | `expires_at_ms` | The worker clock before the signature, plus 120 s |
| 11 | `speaker_score_milli` | The cosine in thousandths |
| 12 | `word_margin_milli` | Section 7.2 |
| 13 | `heard` | The heard words, cut to fit |

The signed message is
`SHA-256("seams:outlayer:voice-verdict:v2" || verdict_json bytes)`. The key
is the ed25519 key `verdict` of the OutLayer project (`bind: "project"`). The
key stays the same across verifier versions.

### 8.1 Refusal reasons

| Reason | Meaning |
| --- | --- |
| `quality` | The energy gate refused the audio. |
| `audio_invalid` | The audio is not a 16 kHz mono PCM16 WAV of at most 8 s. |
| `audio_reused` | The audio digest was used before. |
| `template_missing` | The owner has no template. |
| `speaker` | The speaker score is below the cutoff. |
| `words` | The heard words are not the rendered words. |
| `unsupported` | The input is not a request that this version handles. |
| `speaker_unavailable` | The speaker service did not answer, or its reply failed a check. |
| `transcriber_unavailable` | NEAR AI did not answer, or gave no text. |
| `transcriber_not_attested` | Verifier 0.14.0 and later: the check of NEAR AI's TDX quotes failed, or a reply did not come from the checked gateway. No recording went to NEAR AI. |
| `summary_mismatch` | A community note only (0.13.0 and later): JEV says that the summary does not give the main point of the note. |
| `summary_check_unavailable` | A community note only (0.13.0 and later): JEV did not answer, or gave no fit. |
| `storage` | The worker storage failed. |
| `not_authorized`, `authorization_unavailable`, `template_exists` | `enroll` only. |
| `proposal_missing`, `same_speaker`, `attempts_exhausted` | Multisig only (section 10). |

## 9. Who checks the verdict

A verdict lets a request pass only if all of these are true:

1. The signature is valid for the pinned verifier key.
2. `kind` is `seams_voice_signed_verdict_v2`.
3. `outcome` is `accept`. For `step_up`, the Wallet needs a passkey approval
   too.
4. `expires_at_ms` is not in the past.
5. `request_digest` equals the digest of the request that the checker builds
   itself.
6. In the Wallet, `audio_digest` equals the digest of the clip that core
   recorded.

Four checkers exist:

- **Wallet core and the Seams co-signer.** Core builds the request from the
  transaction that it will sign. It refuses a verdict for another request
  with `verdict_mismatch`. Then it signs exactly one transaction from the
  owner's account. The co-signer does the same check before it signs. This
  path serves `transfer`, `community_note`, `note_rating` and
  `merge_approval`.
- **The voice multisig contract.** `propose` and `approve` take
  `verdict_json` and `signature_b64`. The contract checks them on chain,
  with the caller as the owner. It also refuses an `audio_digest` that
  counted before. This path needs no Wallet release for a new request kind.
- **The note market contract** (`pm-notes.seams-v1.testnet`). It takes a
  bet only with the verdict of that bet: the key, the expiry, and the digest
  of the bettor, market, side and amount. Each verdict counts once. On
  testnet, `get_voice_config` gives `"required":true`.
- **The notes contract** (`notes.seams-v1.testnet`). It checks the verdict of
  each note and rating on chain (`check_spoken`: the key, the outcome, the
  expiry and the digest; each verdict counts once). On testnet,
  `get_voice_config` gives `"required":true`.

**Why both the Wallet and the contracts check the verdict.** Each layer does
the job that only it can do:

- **Off chain (the Seams verify route and threshold co-signer).** It checks the
  TDX quote (`wasm_hash` binding) and the verdict before it co-signs, with 0 gas
  and 0 bytes on chain (see section 9.1). It also guards actions that have no
  contract code on the receiver, such as a native NEAR transfer (`examples/speak-to-pay`) or a
  general transaction.
- **On chain (`notes`, `pm-notes` and `voice-multisig`).** A wallet guards only
  its own users. A bot with a plain NEAR key outside Seams Wallet can call a
  public contract directly over RPC. Each application contract checks the
  64-byte ed25519 verdict signature, the request digest and a single-use marker
  on chain (`~1 Tgas`). A plain key cannot post a note, rate a note, place a bet
  or approve a multisig proposal without a fresh spoken verdict.

### 9.1 The verdict key and the TDX quote

A verdict has two links of trust:

- **The verdict key** shows that a version of the OutLayer project signed.
  It does not name the build: the keystore gives the key to every version
  of the project.
- **The TDX quote of the verifier call** names the build. Its report data
  binds the WASM hash, the input and the output of the call, and the
  verdict is in the output.

[`docs/architecture.md`](architecture.md) section 8.1 records the decision
and the options that do not work. Each checker checks these links:

| Checker | The verdict and its key | The TDX quote of the verifier call |
| --- | --- | --- |
| The Seams verify route (server) | — | Checks it before it returns the verdict: the quote binds the output to the pinned WASM hash, chains to Intel with Intel's collateral, and names a worker image that `worker.outlayer.testnet` approves. It refuses with `attestation_<code>` (`seams-wallet` commit `0b297e976`, `speakToSignAttestation.ts`). |
| Wallet core (the co-signer on the device) | Checks it (items 1–6 above). | Does not check it. Not planned. |
| The Seams co-signer | Checks it. | Does not check it. A verdict that did not pass the verify route gets the key check only. |
| The voice multisig, the note market and the notes contract | Check it on chain. | Do not check it. |

**Why the verify route checks the quote, not the contracts.** In a threshold
wallet, the verify route checks the TDX quote off chain before the co-signer
signs. This design beats an on-chain quote check in three ways:

- **Same hardware root of trust.** The verify route checks the Intel TDX quote
  against Intel's collateral. It binds the output to the pinned WASM hash
  before it returns the verdict (see the table above).
- **Zero chain cost for the quote.** One on-chain DCAP check
  (`tee-verifier-2026-07-22.testnet`) burns about 176 Tgas (0.018 NEAR). It
  also puts about 30 KB of quote data in each call. The off-chain check adds
  0 gas and 0 bytes on chain, so transfers, bets and notes stay cheap.
- **Small on-chain verdict check.** `notes`, `pm-notes` and `voice-multisig`
  still check the 64-byte ed25519 verdict signature on chain in about 1 Tgas
  (`ed25519_verify`). They verify the exact verdict bytes. They do not rebuild
  JSON on chain.

Each voice action comes from the user's own account through the Seams
co-signer. Only a contract that pays any caller with no co-signer in front of
it needs an on-chain quote check. No Speak-to-Sign contract works that way.

**What stays open.** A signer that sends a transaction from a plain key, not
through the Seams Wallet, gets the key check only. The quote check does not
remove the trust in the Seams team, which can deploy both the verifier and
the server.

The plugin gets no signing context, key or session. It can only call the
scoped core operations `openPrompt`, `receiverExists`, `verify`,
`summarizeNote`, `payWithVerdict`, `signNoteWithVerdict`,
`signMessageWithVerdict` and `authorizeEnrollment`
(`SpeakToSignHostOperations` in `hostPlugin.ts`, Wallet 0.69.2).

## 10. Multisig requests

A multisig proposal is hidden behind a salted commitment until `execute`.

- **`multisig_propose`** `{"multisig","proposal_id","receiver","amount_yocto"}`
  and **`multisig_hide_note`** `{"multisig","proposal_id","note_id"}`:
  1. The verifier draws a 32-byte salt and builds the request.
  2. On an accept, it stores the proposal and the salt, and adds the owner
     to the voices of the proposal.
  3. The output has `"multisig":{"commitment","salt"}` and no stage times.
- **`multisig_confirm`** `{"multisig","proposal_id","commitment_hex"}`:
  another member says the same sentence from memory.
  1. The input does not hold the proposal. The verifier loads it by the
     commitment, or refuses with `proposal_missing`.
  2. A refusal has no `spoken_text_digest` and no `word_margin_milli`. So a
     member cannot test guesses offline.
  3. Three `words` refusals of one member for one proposal give
     `attempts_exhausted`. Only a refusal after the speaker check passed
     counts.
  4. A voice that also passes against another member who said the proposal
     refuses with `same_speaker`. So N confirmations need N voices.

Storage of a proposal, in the verifier's OutLayer storage:

| Key | Value |
| --- | --- |
| `msig1:<multisig>:<commitment b64u>:open` | The proposal and the salt, encrypted |
| `msig1:<multisig>:<commitment b64u>:voices` | The owners whose verdict was an accept |
| `msig1:<multisig>:<commitment b64u>:tries:<owner>` | The count of `words` refusals |

The contract (`demo/contracts/voice-multisig`, version 3.0.0) is voice
only. It has a fixed set of signers and a threshold M of N, and no admin.

1. A signer proposes with a verdict of a propose kind. That verdict is the
   first approval.
2. Each other signer approves with a verdict of `multisig_confirm` for the
   stored commitment. The request digest is the same
   `multisig_approval_digest`, with the signer as the owner.
3. The contract refuses a second approval of one signer, and a verdict
   whose `audio_digest` counted before. So one recording counts once.
4. When M signers approved, a signer calls `execute` with the opening (the
   proposal and the salt). The contract checks it against the commitment,
   and sends the NEAR or hides the note.

No call without a verdict approves, and no call changes the signers. Its
README has the interface. Version 3.0.0 is on
`voice-multisig.seams-v1.testnet` since 2026-11-12, with 2 of 2 signers. The
older account `multisig.seams-v1.testnet` (version 2.x, where two admin
accounts approved with plain signed calls) was deleted on 2026-11-12.

## 11. Trust limits

- **OutLayer.** The TEE run of the pinned code, the storage, the signing key
  and the NEAR AI secret. If the TEE or its governance fails, a verdict means
  nothing.
- **Project owner.** The owner of the OutLayer project can deploy a version
  that signs with the same key. The Wallet pins the key, not the code. Such a
  version also reads the audio key and can open sealed audio. The OutLayer
  access rule "One build only" on the secrets profile limits this to one
  WASM hash, until the owner moves the lock.
- **Sealed audio after the verifier.** The verifier sends the opened WAV to
  the speaker service (a Phala TDX VM, its key pinned from its attestation)
  and to Whisper. Verifier 0.14.1 (the active version) checks the Intel TDX
  quotes of NEAR AI's gateway and of Whisper, and sends the WAV only sealed
  to the checked gateway. The code of NEAR AI's VMs and the link from its
  gateway to Whisper stay trusted. Verifier 0.12.0 and 0.13.0 send the WAV
  to NEAR AI over HTTPS and do not check NEAR AI's attestation; the Seams
  staging server still calls 0.13.0. The `venice` build sends the WAV to
  Venice AI, which has no TEE; see
  [`trust-chain.md`](trust-chain.md#the-near-ai-check).
- **NEAR AI.** The transcript has no signature. A false transcript can pass
  the word check.
- **Phala.** The owner of the Phala app can change the service code and keep
  the same key.
- **NEAR RPC.** The verifier does not check a proof of the access-key view at
  enrollment.
- **Voice clones.** A voice clone works only on the person's own device,
  with the Wallet unlocked: VoiceID runs in the Wallet's isolated iframe on
  that device, and the keys stay there. On another device, a clone alone
  cannot unlock the Wallet (see [`judge-questions.md`](judge-questions.md),
  question 2). An attacker needs that device in hand (or malware that
  controls it) and an unlocked Wallet, and with those, the attacker can do
  much more harm than a voice clone. On that device, this build has no
  liveness check and no fresh words, and only a NEAR transfer above 10 NEAR
  also needs a passkey (section 7.3).

## 12. Where the details are

| Topic | File |
| --- | --- |
| Verifier inputs, outputs, versions and the reproducible build | `crates/voice-verifier/README.md` |
| Grammar types and digests | `crates/spoken-intent/src/lib.rs`, `request.rs` |
| Near misses | `crates/spoken-intent/src/confusion.rs` |
| Word decision | `crates/voice-verifier/src/words.rs` |
| Plugin files | `seams-wallet`: `packages/wallet/src/core/transactionFeatures/` |
| Voice multisig contract | `demo/contracts/voice-multisig/README.md` |
| Deployed accounts and versions | The "Testnet facts" table of the root `README.md` |
