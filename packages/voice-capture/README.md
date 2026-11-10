# @seams/voice-capture

Records one spoken sentence in the browser. It opens the microphone, finds the speech, stops at
the pause, checks the quality, and returns 16 kHz mono samples.

It has no user interface and no dependency on a wallet. `@seams/voiceid` and Speak-to-Sign use
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
| `recoveryHint` | `Reload the page and try again.` | The last sentence when a file cannot load |
| `cacheName` | `seams-voice-capture-models-v1` | The browser cache of the model files |

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
