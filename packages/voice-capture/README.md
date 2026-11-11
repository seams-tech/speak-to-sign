# @seams/voice-capture

Records one spoken sentence in the browser. It opens the microphone, finds the speech, stops at
the pause, checks the quality, and returns 16 kHz mono samples.

The core has no user interface, the phrase card is a second entry point, and neither depends on
a wallet. `@seams/voiceid` and Speak-to-Sign use
it, and any web page can use it alone.

## Install

```sh
pnpm add @seams/voice-capture
```

Copy the asset files into a folder that your site serves:

```js
import { copyVoiceCaptureAssets } from '@seams/voice-capture/hosting';

await copyVoiceCaptureAssets('public/voice-capture');
```

| File | Bytes | Needed for |
| --- | --- | --- |
| `voice-activity-worklet.js` | 587 | Every recording |
| `silero-vad.onnx` | 2,327,524 | The detector `model` |
| `ort-wasm-simd-threaded.wasm`, `ort-wasm-simd-threaded.mjs` | 14,264,278 | The detector `model` |

The browser keeps the model files in its cache after the first download. The package checks
the size and the SHA-256 of each model file.

## Record

```ts
import {
  configureVoiceCapture,
  expectedSpeechMs,
  pcm16Wav,
  recordVoice,
} from '@seams/voice-capture';

configureVoiceCapture({ assetBase: '/voice-capture/' });

const sentence = 'Send two NEAR to alice.testnet';
const stop = new AbortController();
const result = await recordVoice(
  stop.signal,
  (event) => {
    // 'opening', 'listening', 'activity' (with the level), 'processing', 'measured'
  },
  { expectedSpeechMs: expectedSpeechMs(sentence) },
);

if (result.kind === 'captured') {
  const wav = pcm16Wav(result.samples); // 16 kHz mono PCM16, at most 8 s
} else {
  // 'insufficient_audio': less than 0.6 s of speech, or too much noise. See result.quality.
}
```

- Call `recordVoice` from a click or a key press, on a page that is in front. The browser asks
  the person for the microphone.
- The recording ends after a pause of 1.5 s, or 0.8 s once the voiced time covers the expected
  sentence, or after 8 s.
- `stop.abort()` cancels the recording and stops the microphone. The promise then rejects.
- `pcm16Wav` gives the audio format of the Speak-to-Sign verifier.

## The phrase card

`@seams/voice-capture/card` has the card that the Seams Wallet shows: the sentence, a Record
button, the voice line, and then your check and your result on the same card. It needs no
React: the package brings its own small renderer.

```ts
import { openPhraseCard } from '@seams/voice-capture/card';

const surface = openPhraseCard({
  sentence: 'Send two NEAR to alice.testnet',
  signal: new AbortController().signal,
  frame: { parent: document.querySelector('#card') },
});
try {
  const recording = await surface.record(); // the person selects Record and speaks
  if (recording.kind === 'recorded') {
    void surface.show({
      kind: 'check',
      label: 'Checking',
      caption: 'Checking your voice',
      details: ['One moment.'],
      segments: ['done', 'run'],
    });
    const answer = await yourCheck(pcm16Wav(recording.samples));
    await surface.show({
      kind: 'result',
      label: '',
      headline: answer.ok ? 'Approved' : 'Not approved',
      caption: 'Send two NEAR to alice.testnet',
      detail: answer.text,
      action: { label: 'Done' },
      line: answer.ok ? 'seal' : ['done', 'fail'],
    });
  }
} finally {
  surface.close();
}
```

- `record()` resolves with `recorded` (the samples) or `cancelled`. A too quiet recording
  stays on the card with "Try again".
- `autoStart: true` starts the first recording with no press on Record. Use it when the person
  just asked for the card with a click or a key. The card then shows no Record button and has
  no row for it, so it is shorter and its rows sit in the middle. If the browser starts audio
  only after a press, the card shows its Record button; "Try again" and a result's button
  bring the row back too.
- `show()` resolves with `action` when the person selects the button of a result, `closed`
  when the person closes the card, or `replaced` when a new view or recording takes its place.
- The card uses the CSS variables `--seams-colors-*`, `--seams-shape-*` and
  `--seams-font-family` when the page sets them, and has its own values when it does not.
  Record and the other main buttons use `--seams-colors-buttonBackground` and
  `--seams-colors-textButton`. Without them, the main button has the text colour
  (`textPrimary`) with the card's background colour as its text.
  The voice line and the Beam glow under it take these values, and keep today's look
  without them:

  | CSS variable | Theme key (Seams Wallet) | What it sets | Default |
  | --- | --- | --- | --- |
  | `--seams-colors-voiceLine` | `colors.voiceLine` | The voice line, its ring and its seal | The text colour |
  | `--seams-colors-voiceEcho` | `colors.voiceEcho` | Echo lines 1 and 3 behind the line | `voiceLine` |
  | `--seams-colors-voiceEchoDeep` | `colors.voiceEchoDeep` | Echo line 2 | `voiceEcho` |
  | `--seams-colors-voiceBeam` | `colors.voiceBeam` | The Beam palette: `colorful`, `mono`, `ocean`, `sunset`, `forest`, `candy`, `ice` or `gold`. `mono` is grey, band included | `ocean` |
  | `--seams-shape-voiceLineWidth` | `shape.voiceLineWidth` | The width of the voice line | `1px` |
  | `--seams-shape-voiceEchoWidth` | `shape.voiceEchoWidth` | The width of the echo lines | `0.65px` |
  `data-theme="light"` or `"dark"` on the page selects the glow colours.
- `frame` adds what a host needs: the parent element, more class names, the corner controls,
  and a callback when the card is in the document.
- `frame.controls` sets the corner controls: `'close'` (default), `'back'` (Back in place of
  Close) or `'back_and_close'`. Back is in the leading corner, Close in the trailing corner.
  Each one ends the card. `frame.pressed(control)` tells you which one the person
  pressed, before the card ends. Escape also ends the card, with no `pressed` call.
- `VoicePrompt`, `PhraseCard`, `VoiceRibbon` and `VoiceVisual` are exported for a host that
  makes its own surfaces.

## The example

```sh
pnpm build
pnpm example
```

Open `http://localhost:4599/example/`. The page records one sentence on the card, or three
enrollment phrases one after another, with this package alone.

## Two detectors

| `detector` | Download | What it finds |
| --- | --- | --- |
| `model` (default) | About 16.6 MB, one time | Speech, with the Silero voice activity model |
| `level` | None | Any sound above the level. It cannot tell speech from other loud sound. |

```ts
await recordVoice(stop.signal, observer, { detector: 'level' });
```

## Settings

`configureVoiceCapture` takes:

| Option | Default | Use |
| --- | --- | --- |
| `assetBase` | none (required) | The folder URL of the asset files |
| `microphonePreference` | kept until the page reloads | `{ read, save }` to keep the chosen microphone |
| `label` | `Voice capture` | The product name in messages |
| `place` | `this page` | The place name in messages ("Keep this page open and focused ...") |
| `site` | `this site` | The site name in messages ("... is unavailable from this site.") |
| `recoveryHint` | `Reload the page and try again.` | What the person can do when a file cannot load |
| `cacheName` | `seams-voice-capture-models-v1` | The browser cache of the model files |
| `styleNonce` | none | The nonce of the page's style policy, for an older browser that needs a style element |

## Privacy

The audio stays in the page. The package sends nothing to a server. It overwrites its audio
buffers with zeros after use; the caller owns the returned samples and must do the same.

## Tests

```sh
pnpm build
pnpm test
```

The `chromium` tests record from a fake microphone that plays
`tests/fixtures/speech-then-silence.wav` (synthetic speech from macOS `say`).

## Licences

The package is Apache-2.0. The Silero voice activity model is MIT (`SILERO_LICENSE.txt` in the
asset folder). `onnxruntime-web` is MIT.
