# Plan: code organisation for 0.62

This plan makes the Speak-to-Sign code in this repository easier to read. It changes no
behaviour. Each step moves code to the module that owns it, removes a duplicate, or gives a
name to a value. The plan covers four parts:

- `crates/spoken-intent`
- `crates/voice-verifier`
- `packages/speak-to-sign`
- `examples/speak-to-pay`

The plan does not change `crates/speaker-service`, `demo/` or `research/`. It does not change
seams-wallet or seams-monorepo.

## Rules for every step

- The signed output stays byte-identical. The committed vectors are the proof:
  `crates/spoken-intent/fixtures/spoken_intent_vectors_v1.json` and
  `crates/voice-verifier/testdata/*.json`. A step that changes a vector is wrong, except for the
  verifier version string in Step 9.
- Delete the code that a step replaces, in the same commit. Add no shims and no second paths.
- Export only what another file uses.
- Do not put refactor, phase or plan numbers in code comments. Say what the code does and why.
- Keep each file under 2,000 lines.
- One commit for each step. Each commit builds and passes its tests.

## Why `speaker-service` is not in this plan

The speaker service runs in an attested Phala TDX machine. Any change to its `src/` gives a new
image and a new compose hash. Then the source in this repository no longer matches the attested
machine until the service is deployed again. So its refactor waits for the next service release.
The items for that release are at the end of this plan.

## Part 1: `crates/spoken-intent`

The fixture test `committed_spoken_intent_vectors_match_generator` pins the output of render,
the digests, `confusion_set`, `normalize`, `parse_transfer`, `normalize_punctuated` and
`phonetic_key`. If the fixture stays byte-identical, the behaviour did not change.

### Step 1: one module for spoken tokens

- Move `SpokenToken` from `render.rs` to a new `token.rs`. Re-export it from `lib.rs` as now.
- Add `token_words(&[SpokenToken])`. It replaces the six local
  `.map(SpokenToken::as_str).collect()` copies in `parse.rs`, `phonetic.rs` and `punctuated.rs`.
- Add a public `spoken_text(&[SpokenToken]) -> String`. The verifier uses it in Step 7.
- Use one import path, `crate::token::SpokenToken`, inside the crate.
- Give names to the magic values: `MAX_ACCOUNT_ID_LEN`, `IMPLICIT_ACCOUNT_LEN`,
  `CHALLENGE_LEN`. Name each punctuation list by its purpose.

### Step 2: one module for separator spelling

- Add `spelling.rs` with `SEPARATORS: [(char, &str); 3]`, `separator_word` and
  `spelled_parts(text)`.
- Use it in `account.rs`, `normalize.rs` and `punctuated.rs`. Delete their local copies and
  `SEPARATOR_WORDS`.
- This code makes the signed `spoken_text`. The fixture must stay byte-identical.

### Step 3: split `punctuated.rs` along its three stages

- `punctuated/mod.rs`: `normalize_punctuated`, `PunctuatedRefusal` and the public doc.
- `punctuated/text_step.rs`: the text step.
- `punctuated/slots.rs`: the send-slot rules and their sound-alike tables.
- `punctuated/recipient.rs`: the recipient match and its tables.
- Replace `contact_by_key(.., loose: bool, one_edit: bool)` with `enum KeyForm { Heard, Loose }`
  and `enum KeyMatch { Equal, OneEditSameStart }`, and a named `MATCH_PASSES` list.
- Add `only_match()` for the "exactly one contact" check, which is written twice.
- Keep one `pub(crate) const SEND_FORMS` in `slots.rs`. `summary.rs` uses it in place of its own
  `TRANSFER_VERBS` copy.
- Put the functions of each file in call order.
- Fix the `RecipientUnkeyable` doc. It must give the real cause: an empty word, or a word longer
  than `MAX_ACCOUNT_ID_LEN`.

### Step 4: one near-miss function for each request kind

- In `confusion.rs`, write `transfer_near_misses`, `approval_near_misses`,
  `merge_near_misses` and `note_near_misses`. Each one destructures its request one time and
  renders each variant one time. This removes the three kind matches and their two dead arms.
- Add `insert_not_everywhere` for the code that is written twice.
- Add `digit_changes(value, min_digits)` with checked arithmetic. Use it for the PR number and
  for the amount. It replaces three styles of digit change.
- Rename `NEGATIONS` to `NEGATION_PREFIXES` and `NOTE_NEGATIONS` to `NEGATION_WORDS`.
- If it stays simple, take the clause positions from the render step in place of the token
  arithmetic (`2 + id_words.len()`, `len() - 2`). If it does not stay simple, leave this item.
- `confusion_set` returns a `BTreeSet`, so the order of insertion has no effect on the output.

### Step 5: tests that are easy to find

- Split `tests/grammar.rs` into `tests/render.rs`, `tests/normalize.rs`,
  `tests/punctuated.rs` and `tests/accounts.rs`.
- Put the shared helpers in `tests/support/mod.rs`: the challenge lookup (written three times),
  `parsed(receiver, hundredths)` (the `ParseResult::Transfer` literal is written seven times)
  and the implicit test account.
- In `tests/vectors.rs`, put the transfer cases in one `TRANSFER_CASES` table. Keep the case
  order, so that the fixture stays the same.
- Fix the crate doc in `lib.rs`: the Wallet has a TypeScript port of the rules, and no contract
  links this crate.

### Not in this plan

- The case name `unknown_request_kind_6` in the fixture is now wrong, because tag 6 is
  `MergeApproval`. A rename changes the fixture and the Wallet's copy of it. Do it the next time
  the fixture is generated again.
- `UnsupportedReason` has two variants, but each caller can return only one. A split changes the
  public API that seams-monorepo's stt-bench builds against.

## Part 2: `crates/voice-verifier`

`tests/ops.rs` checks the exact refusal detail strings. `tests/signed_vector.rs` and
`tests/enrollment_vectors.rs` check the signed bytes. These tests must pass with no change to
their expected values.

### Step 6: split `ops.rs` by job

- `ops/mod.rs`: the `run` entry and the operation dispatch.
- `ops/request.rs`: the request typing (`transfer_request` and the note and merge inputs).
  Parse the owner one time. Add one `unsupported()` helper for the twelve
  `map_err(|_| Reason::Unsupported)` calls.
- `ops/enroll.rs` and `ops/verify.rs`: one flow each. Both flows return their output struct.
- Move `words_pass` to `words.rs`.
- Add `Refusal { reason, detail }` with `From<Reason>`, so that `?` carries both values. This
  replaces the `&mut Option<String>` detail parameters.
- Add one `reply()` function for the three copies of the
  `Some(Ok) / Some(Err) / None` match. Keep the detail strings the same.
- Add a `Stages` timer with `time(name, f)` in place of the `Instant::now()` and `ms.insert`
  pairs. Keep `ms` a `BTreeMap`, and keep the keys that are written only in some cases.
- Add one `in_flight()` helper for the start, storage, wait and cancel steps that both flows
  repeat.

### Step 7: output, speaker and authorization modules

- In `output.rs`, add `fit_heard` and `sign_verdict`. Give names to the size values
  (`HEARD_CAPS`, `SIGNATURE_B64_LEN`, `STAGE_TIME_ROOM`). Build `VerifyOutput` in one
  constructor.
- Add `ENROLL_OUTPUT_KIND` and `ERROR_OUTPUT_KIND` beside `VERIFY_OUTPUT_KIND`.
- Split `speaker.rs` into `speaker_client.rs` (the service client), `embedding.rs` (the
  embedding math and the enroll rule) and `template.rs` (the stored template record). Write the
  f32 decode and the record length one time.
- Use one meaning for each name: `output::Enrollment` becomes `output::EnrollOutput`, to match
  `VerifyOutput`. `speaker::Enrollment` becomes `embedding::Agreement`. `enrollment.rs` becomes
  `authorization.rs`, because it holds the NEP-413 check and the access-key RPC.
- Use `spoken_intent::spoken_text` in `words.rs` in place of the local join.
- Make the items that no other file uses `pub(crate)`, or `#[cfg(test)]` when only a test uses
  them.
- Remove the plan section numbers from the comments in `config.rs`, `transcriber.rs` and
  `lib.rs`.

### Step 8: a small `main.rs` and tests that are easy to find

- Move the WASM host and the `wasi:http` batch code from `main.rs` to `src/wasm_host.rs` and
  `src/wasm_host/http_batch.rs`. `main.rs` stays the entry point.
- Make the `full` vector of `drive` a field of `Flight`, and add one `Flight::finish_with` for
  the code that `fail` and `collect` share.
- Make `tests/ops.rs` one test binary in `tests/ops/`: `main.rs`, `fake.rs` (the fake host and
  the input builders), `enroll.rs`, `verify.rs`, `notes.rs` and `merges.rs`.
- Add one `outcome_name(&Verdict)` helper in place of the two copies. Split `verify_refusals`
  into one test for each refusal.

### Step 9: verifier version 0.5.2

The moves change the WASM hash, because panic messages carry the file and the line. The Wallet
pins the verdict key, not the hash, so this is a new version and not a contract change.

- Set `0.5.2` in `Cargo.toml` and `config::VERIFIER_VERSION`.
- Write the signed vectors again with `SEAMS_WRITE_VECTOR`. Only the `"verifier"` field may
  change. The signatures change because they sign that field.
- Build with `./build.sh --docker`. Add the hash and the size to the Versions table in
  `crates/voice-verifier/README.md`, as "built, not deployed".

## Part 3: `packages/speak-to-sign`

`tests/flow.test.ts` and `tests/enroll.test.ts` check the order of the card states and the
Wallet calls. `tests/api.typecheck.ts` checks the public API. These must pass.

### Step 10: one job for each host file

- `host/heardWords.ts`: the heard-word alignment (`heardCaption`, `alignedWords`,
  `normalWord`) from `card.ts`. Test `heardCaption` directly.
- `host/prompt.ts`: the prompt lifecycle that `flow.ts` and `enroll.ts` share: open the prompt,
  record a clip, close the prompt, the `voiceid_unavailable` and `verifier_unavailable`
  results, and one `shortDetail` for the three `.slice(0, 200)` copies. The enrollment hands its
  last prompt on to the result card, so the helper must allow that.
- `host/result.ts`: `FailedResult`, `SpokenResult` and `mapPayment`.
- `host/verifier.ts`: the verifier wire format: `verifyInput`, `enrollInput` and
  `readEnrollmentOutput`. Type the refusal list as a `Record` of the Wallet's reason type, so a
  new reason fails to compile. Use type guards in place of `isReason.bind` and the `as number`
  casts.
- Update `src/README.md`, because it lists what each host file holds.

### Step 11: card copy by name

- Name the card segments: `PAYMENT_LINE` and `ENROLL_LINE` as `const` arrays of segment names,
  and `line(upTo, state)`. Type `FailureCopy.at` as a segment name. This removes the two
  numbering schemes and the later changes to the segment array.
- Write the verifier step labels one time.
- Put the network names and the explorer URLs in one `NETWORKS` record.
- Name the `'heard: '` prefix `HEARD_PREFIX`. The Wallet writes it, so it is a contract.
- `stepUpView` takes `'asking' | 'waiting'` in place of a `boolean`.

### Step 12: the payment flow and the tests

- In `signOnce`, replace the `approved` and `signedFrom` flags with one union:
  `{ kind: 'voice' } | { kind: 'passkey'; approvedAt }`. Add `paymentHooks(prompt, card)` and a
  pure `stageTimes(...)`.
- In `runSpokenNote`, build the card input one time. Remove the parameters that nothing reads.
- Make the comments that name a release say what the code does.
- Add `tests/fakeHost.ts` with the shared fake host, `clip()` and the reply builders. Add
  `noteInput()`. Use one payment queue in place of `payment` and `payments`. Put one scenario in
  each test.

### Step 13: remove the empty `./react` entry

`src/react.ts` is `export {}`. It ships as `@seams/speak-to-sign/react` with an optional `react`
peer dependency.

- Delete `src/react.ts`, the `./react` export, the `react` peer dependency and its build input.
- This changes the public API. The entry exports nothing, so no app can use it. Say so in the
  release notes.

### Not in this plan

The plugin writes types such as `Parameters<SpeakToSignHostPlugin['requestTransfer']>[0]`
because `@seams/wallet/speak-to-sign-host` does not export the input types. The fix is in
seams-wallet.

## Part 4: `examples/speak-to-pay`

### Step 14: an example that shows the two calls first

- `src/hooks.ts`: `useLoaded`, `useOutcome` and `useWalletConnection`.
- `src/components.tsx` (it exists): add `StepCard`, `Notice`, `Fact` and one `ReasonNotice` in
  place of the four copies of the refused and unavailable notices.
- `src/results.tsx`: `EnrollmentResult` and `TransferResult`.
- `PaymentFlow.tsx` keeps the steps. One `stepStatus(outcome, ready, isDone)` with early returns
  replaces the nested status ternaries.
- `PayStep` shows an error when `speakToSign` is not set, as `EnrollStep` does. Today it does
  nothing.
- `text.ts` uses the Wallet's `SpeakToSignUnavailableReason` type.

## Release 0.62

The refactor lands on `dev` after the 0.61.0 release of `@seams/speak-to-sign`.

1. Merge branch `code-organisation` into `dev`.
2. Release `@seams/wallet`, `@seams/voiceid` and `@seams/wallet-server` 0.62.0 from
   seams-wallet. The plugin builds against them, so they go first.
3. Set `0.62.0` in `packages/speak-to-sign/package.json` (the version, and the peer and dev
   dependencies on `@seams/wallet` and `@seams/voiceid`). Install against the published
   packages, then commit the lockfile.
4. Dispatch `release-speak-to-sign.yml` with `version=0.62.0`.
5. Upload verifier 0.5.2 to FastFS, call `add_version`, and make it the active version. Then pin
   its version key in seams-monorepo and deploy staging.

Steps 2 to 5 publish or deploy, so each one needs the owner's approval.

## For the next speaker-service release

- Split `src/lib.rs` into `wav.rs` and `wire.rs`, with a typed `EmbedRequest::parse` and an
  `EmbedReply` struct. The `embed` handler then only runs the steps.
- Add `KeySource { Dev(seed), Agent(Client) }` in place of the second environment read in
  `key()`.
- Fix the comment that calls `lib.rs` pure; it declares the `dstack` I/O module.
- Remove the refactor numbers from `src/lib.rs`, `Cargo.toml`, `Dockerfile` and `model.rs`.
- Add a shared `testdata/speaker_embed_v1.json` that both the service tests and the verifier
  tests read. Do not share code between the two crates: they are separate attested builds.
- After the deploy, check that the pinned speaker key did not change.
