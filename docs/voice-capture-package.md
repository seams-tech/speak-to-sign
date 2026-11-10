# The `voice-capture` package

Status, 2026-11-11: slices 1 and 2 are built in `packages/voice-capture`. Slice 3 is a local
commit in seams-wallet on the branch `claude/voiceid-voice-capture`: VoiceID imports this package
and its copies of the moved files are deleted. Slice 4 (the release) is not started. The
seams-wallet branch cannot install in CI before `@seams/voice-capture` is on npm.

What slice 3 measured:

- The VoiceID host files of the build are the same bytes for the speech detection model, the
  audio worklet, the model engine and the notices.
- The VoiceID host code is not larger: 359,578 bytes before the minifier against 364,725 bytes,
  with one copy of Preact. The library has one file for each source file, so the phrase card
  stays a later download (14.7 kB) as before.
- VoiceID has no import of `onnxruntime-web` of its own: `BrowserInferenceModel.run` makes the
  input tensor.

## The owner's target structure

Repository seams-wallet:

- `@seams/voiceid`: mostly the VoiceID auth method, tied to the Wallet.
- `@seams/wallet` (client) and `@seams/wallet-server` (server).

Repository speak-to-sign:

- `voice-capture`: this package.
- `voice-verdict`: the check of a signed verdict.
- `speak-to-sign`: depends on `voice-capture` and `voice-verdict`. The owner may give it a more
  accurate name later.

## Goal

Take the capture code out of `@seams/voiceid` (repository `seams-tech/seams-wallet`,
`packages/voiceid`) into a package `@seams/voice-capture` in this repository
(`packages/voice-capture`).

The owner's rules:

1. A web2 developer can use the capture code with no `@seams/wallet` and no `@seams/voiceid`.
2. One set of three voice recordings enrolls both VoiceID and Speak-to-Sign. There are never
   two sets.
3. VoiceID, the auth method, stays in the seams-wallet repository.
4. The package has a name such as `voice-capture` and is in the speak-to-sign repository.

## Facts (measured in seams-wallet at commit `1d8286969`)

### The files

`packages/voiceid/src` has 6,880 lines. Speak-to-Sign uses one thing from it at run time: the
phrase surface `openPhrase` (`capture/phrase.ts`). The Wallet loads the VoiceID host plugin and
gives that surface to the Speak-to-Sign plugin.

The files that `openPhrase` needs at run time:

| File | Lines | What it does |
| --- | --- | --- |
| `capture/phrase.ts` | 247 | The phrase surface: sentence, recording, check and result on one card |
| `capture/phraseCard.ts` | 543 | The check and result views |
| `capture/prompt.ts` | 1,150 | The prompt: the sentence, the action row, the errors, the microphone menu |
| `capture/visual.ts` | 91 | The voice glow (uses `preact` and `voice-glow`) |
| `browser/ribbon.ts` | 531 | The voice ribbon |
| `browser/microphone.ts` | 497 | `recordVoice`: one utterance, with the quality gate |
| `browser/microphoneInput.ts` | 161 | Opens the microphone; the microphone preference |
| `browser/voiceActivity.ts` | 66 | The voice activity model |
| `browser/speechPause.ts` | 42 | The expected speech time of a sentence; the end pause |
| `browser/inference.ts` | 217 | Downloads and starts a model with `onnxruntime-web` |

That is 3,545 lines.

The local phrase check is **not** part of the run-time path of the phrase surface.
`browser/phrase.ts` (324 lines), `phraseTokens.ts` (260) and `phraseVocabulary.ts` (319) are
VoiceID's own challenge check (`checkSpokenPhrase`). The capture files use only a type
(`SpokenPhrase`) and one placeholder string (`SPOKEN_PHRASES[0]`) from them.

These ten files import no VoiceID file outside the set, except that type and that string.

### Who else uses the set inside VoiceID

| VoiceID file | Uses from the set |
| --- | --- |
| `browser/enrollment.ts` | `microphone`, `prompt` |
| `browser/verification.ts`, `verificationError.ts` | `microphone` |
| `browser/model.ts`, `browser/progress.ts` | `inference`, `voiceActivity` |
| `capture/surface.ts`, `capture/unlockFrame.ts`, `capture/deviceBridge.ts` | `prompt`, `microphone`, `microphoneInput` |
| `session/unlock.ts`, `session/operation.ts`, `activation/addVoiceId.ts` | `microphone` |
| `host.ts` | `capture/phrase.ts` |

So the prompt and the microphone are also the user interface and the recorder of the VoiceID
unlock and enrollment. VoiceID will import them from the new package.

### What the set takes from the Wallet (`@seams/wallet/voiceid-host`)

| Thing | Used in | Kind |
| --- | --- | --- |
| `PhraseView`, `PhraseSegmentState`, `PhraseChoice`, `AuthMethodPhraseSurface`, `AuthMethodPhraseRecording` | `phrase.ts`, `phraseCard.ts` | Types |
| `WalletAuthMethodHostPlugin`, `UiConfirmSurfaceMeasurementBinding`, `WalletIframeSurfaceMeasurementReporter` | `phrase.ts` | Types |
| `anchoredCardChrome`, `createWalletIframeSurfaceMeasurementReporter` | `phrase.ts` | Wallet iframe frame and size reports |
| `WorkerDeferred`, `toError`, `isPlainObject`, `Variant` | several | Small helpers |
| `readVoiceMicrophonePreference`, `saveVoiceMicrophonePreference`, `VoiceMicrophonePreference` | `microphoneInput.ts` | Storage in the Wallet |
| `getDefaultCspNonce`, `createCspStylesheetManager` | `prompt.ts`, `visual.ts` | Style nonce of the page security policy |
| `VoiceIdTranscriptionModel` | `browser/phrase.ts` | Type (stays in VoiceID) |

No item touches a key, a session or a signature.

### The assets

| Asset | Bytes | Used by | Goes to |
| --- | --- | --- | --- |
| `ort-wasm-simd-threaded.wasm` (from `onnxruntime-web`) | 14,239,897 | Every model | `voice-capture` |
| `silero-vad.onnx` | 2,327,524 | Voice activity | `voice-capture` |
| `voice-activity-worklet.js` | 587 | The recorder | `voice-capture` |
| `citrinet-int8.onnx` | 10,483,704 | VoiceID's phrase check | stays in VoiceID |
| `aurora-int8.onnx` | 1,342,384 | VoiceID's phrase check | stays in VoiceID |
| `redimnet-b1.onnx` | 8,859,593 | VoiceID's speaker model | stays in VoiceID |

A web2 developer who uses `voice-capture` with voice activity downloads about 16.6 MB once.
The asset paths are fixed strings today (`/sdk/voiceid/...`).

### The enrollment today

- `speakToSign.enroll` in the Wallet: if the wallet has no VoiceID, the handler runs the VoiceID
  activation with `keepRecordings`. The three samples of that enrollment become the verifier's
  recordings (`adoptVoiceIdRecordings`). The owner reads three phrases one time.
- If the wallet has VoiceID already, the plugin records three phrases for the verifier. VoiceID
  keeps no audio after it makes its template.

## The package

`packages/voice-capture` in this repository, npm name `@seams/voice-capture`, with no
`@seams/*` dependency. Dependencies: `onnxruntime-web`, `preact`, `voice-glow`.

### Entry point `.`: the capture core (no user interface)

- `configureVoiceCapture({ assetBase, microphonePreference?, styleNonce? })`: where the assets
  are, an optional store for the chosen microphone, and an optional style nonce.
- `recordVoice(signal, observer, { expectedSpeechMs? })`: one utterance with the quality gate.
- `expectedSpeechMs(sentence)`, `endPauseMs(...)`.
- `openVoiceMicrophone`, `rememberVoiceMicrophone`, `useSystemVoiceMicrophone`.
- `pcm16Wav(samples)`: the verifier's audio format (16 kHz, mono, PCM16, at most 8 s).
- `BrowserInferenceModel`, `voiceActivityModel`: the model loader. VoiceID uses the loader for
  its own models.
- Types and errors: `VoiceCaptureEvent`, `VoiceCaptureQuality`, `VoiceActivityEvent`,
  `InsufficientVoiceAudioError`, `VoiceMicrophoneInterruptedError`, the load error.

### Entry point `./card`: the phrase card

- `openPhraseCard({ sentence, signal, frame? })` returns the surface `{ record, show, close }`.
  It is today's `openPhrase` without the Wallet iframe parts.
- The surface types: `PhraseSurface`, `PhraseRecording`, `PhraseView`, `PhraseCheckView`,
  `PhraseResultView`, `PhraseSegmentState`, `PhraseChoice`, `PhraseText`.
- `VoicePrompt`, `PhraseCard`, `VoiceRibbon`, `VoiceVisual`, `leaveSurface`: the building
  blocks. VoiceID uses them for its unlock and enrollment surfaces.

### Entry point `./hosting`

- The list of the assets and a function that copies them into a folder. The VoiceID hosting
  script calls it, so the Wallet host still serves every file from `/sdk/voiceid/`.

## What moves, what stays, what changes

| File | Action |
| --- | --- |
| The ten files of the set | Move to `packages/voice-capture/src` |
| `browser/phrase.ts`, `phraseTokens.ts`, `phraseVocabulary.ts` | Stay in VoiceID |
| `browser/model.ts`, `enrollment.ts`, `enrollmentStore.ts`, `verification.ts`, `progress.ts` | Stay in VoiceID; import the loader and the recorder from the package |
| `capture/surface.ts`, `unlockFrame.ts`, `deviceBridge.ts`, `session/*`, `activation/*` | Stay in VoiceID; import the prompt and the recorder from the package |
| `capture/phrase.ts` | Splits: the surface moves; a thin adapter stays in VoiceID |

How each Wallet dependency goes away:

| Thing | Solution |
| --- | --- |
| The phrase surface types | The package defines them. See "The Wallet's types" below. |
| `WorkerDeferred`, `toError`, `isPlainObject`, `Variant` | The package gets its own small versions (`Promise.withResolvers`, three short functions). |
| The microphone preference | An option of `configureVoiceCapture`. VoiceID passes the Wallet's storage. The default keeps the choice in memory. |
| The style nonce | An option of `configureVoiceCapture`. VoiceID passes the Wallet's nonce. |
| `anchoredCardChrome`, the size reporter, the measurement binding | Stay in the VoiceID adapter. The adapter gives the card a `frame` object (where to mount, and a callback when the size changes). |
| `SpokenPhrase` type, `SPOKEN_PHRASES[0]`, the display map of VoiceID's challenge phrases | The prompt takes plain text. VoiceID passes its own display text. |
| The asset paths | From `assetBase`. VoiceID passes `/sdk/voiceid/`. |
| Error texts that say "VoiceID" (12 places in the set) | The caller gives a product label; the default is neutral ("Voice capture"). |

### The Wallet's types

`@seams/wallet` defines `AuthMethodPhraseSurface` and `PhraseView` in
`core/authMethods/hostPlugin.ts`, and the Speak-to-Sign plugin gets the surface through that
interface. Two ways:

- **A (recommended):** `@seams/wallet` keeps its own types and gets no new dependency. The
  package defines the same shapes. A type test in `@seams/voiceid` checks that the package's
  surface is assignable to the Wallet's interface.
- **B:** `@seams/wallet` imports the types from `@seams/voice-capture`. Then the core SDK
  depends on a package from another repository.

With A, the host API versions of VoiceID (11) and Speak-to-Sign (10) do not change, because the
Wallet's interfaces do not change.

## The enrollment with three recordings

Inside the Wallet nothing changes in the flow:

1. `speakToSign.enroll` starts the VoiceID activation when the wallet has no VoiceID.
2. VoiceID records three phrases with `recordVoice` from the package and makes its local
   template.
3. The Wallet gives the same three samples to the Speak-to-Sign plugin, which sends them to the
   verifier.

The package does not own the enrollment. It gives both sides one recorder and one sample
format (16 kHz mono `Float32Array`, and `pcm16Wav` for the verifier). The Wallet stays the one
that passes the samples on.

Without the Wallet, a developer calls `recordVoice` three times and sends the three WAV files
to the verifier's `enroll`. There is no VoiceID in that case, so there is one enrollment.

The case that exists today and stays: a wallet with an older VoiceID enrollment must read three
phrases again for Speak-to-Sign.

## Build, release and development

- Release order for one version: `@seams/voice-capture` first (it depends on nothing of ours),
  then `@seams/wallet` and `@seams/voiceid`, then `@seams/speak-to-sign`.
- `@seams/voiceid` gets `@seams/voice-capture` as a dependency with an exact version. In
  seams-wallet, a new private pin needs the release-age exclusion during `pnpm install`.
- For work on both repositories at one time, link the built package into VoiceID:
  `packages/voiceid/node_modules/@seams/voice-capture` -> `speak-to-sign/packages/voice-capture`.
  The tests of seams-wallet read the package from that path. A link gives the host a second
  copy of Preact (about 12 kB); an installed package does not.
- The VoiceID build copies the capture assets from the package (through `./hosting`), so
  `seams-voiceid-host` and `seams-speak-to-sign-host` give the same folder as today.
- Tests that move with the code: `tests/unit/voiceIdSpeechPause.unit.test.ts` and the capture
  parts of `tests/wallet-ui/voiceid-microphone.chromium.test.ts` and
  `voiceid-loading.browser.test.ts`. The unlock, phrase-tolerance and citrinet tests stay in
  seams-wallet.

## Risks

- **Two repositories for the unlock path.** The recorder and the prompt of the VoiceID unlock
  will be in this repository. A change of the unlock card then needs a release here first.
  This is the cost of rule 4.
- **The Wallet's bundle rules.** The Wallet marks only CSS as a side effect, so a bare import is
  dropped. The package must export by name, and the built sizes must be compared before and
  after.
- **The Linux WebKit loading test.** A looping CSS animation on the loading card broke it once.
  The loading user interface must stay static.
- **Behaviour must not change.** The move is safe only if the unlock, the activation, the
  phrase surface and the Speak-to-Sign enrollment pass their existing browser tests in three
  engines.
- **The bloat check of seams-wallet.** Dead exports and duplicated lines must not grow; the
  moved files must be deleted there in the same change.

## Slices

1. **The capture core.** Make the package. Move `inference`, `voiceActivity`, `speechPause`,
   `microphoneInput`, `microphone`, add `pcm16Wav` and `configureVoiceCapture`. Unit tests here.
   No change in seams-wallet yet.
2. **The card.** Move `ribbon`, `visual`, `prompt`, `phraseCard` and the surface. An example
   page here records one sentence and three enrollment phrases with the package alone.
3. **VoiceID uses the package.** In seams-wallet: delete the moved files, add the adapter, pass
   the options, add the type test. Run the VoiceID and Speak-to-Sign tests in three engines.
4. **Release** together with the next Wallet version (after 0.66.0), in the order above.

Slices 1 and 2 touch only this repository. Slice 3 is the one that can break the unlock.

## Answers of the owner (2026-11-10)

The owner accepted the recommended answer to each question below: (1) way A; (2) yes, the
detector `level` needs no model; (3) the Wallet's version number; (4) the default label is
"Voice capture", and VoiceID passes its own name; (5) keep today's behaviour.

## Questions for the owner

1. **The Wallet's types:** way A (the Wallet keeps its types, no new dependency) or way B?
2. **The download for a web2 developer:** voice activity needs about 16.6 MB (the model engine
   and the model). Do you want a second, simple end rule with no model (a stop call or a
   silence level), so that a small app downloads nothing?
3. **Versions:** does `@seams/voice-capture` use the Wallet's version number and release with
   it, or its own version numbers?
4. **The product label:** which default text replaces "VoiceID" in the capture errors for a
   web2 developer?
5. **The older VoiceID enrollment:** when a wallet with VoiceID adds Speak-to-Sign, the owner
   reads three phrases again. Keep that, or let that reading also replace the VoiceID template?
