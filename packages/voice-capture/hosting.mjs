// The files that a page must serve from the folder that it gives to configureVoiceCapture.

import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const assets = fileURLToPath(new URL('./assets/', import.meta.url));

/** Every file of the asset folder. The model engine is the file of the pinned onnxruntime-web. */
export const voiceCaptureAssets = Object.freeze([
  'silero-vad.onnx',
  'voice-activity-worklet.js',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
  'NOTICE.txt',
  'SILERO_LICENSE.txt',
]);

/** Copies the asset files into `outputDirectory` and returns their names. */
export async function copyVoiceCaptureAssets(outputDirectory) {
  await mkdir(outputDirectory, { recursive: true });
  for (const fileName of voiceCaptureAssets) {
    await cp(path.join(assets, fileName), path.join(outputDirectory, fileName));
  }
  return voiceCaptureAssets;
}
