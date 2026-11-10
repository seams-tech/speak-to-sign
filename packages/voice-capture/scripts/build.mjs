import { rolldown } from 'rolldown';
import { cp, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = path.join(root, 'dist');
process.chdir(root);
await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'assets'), { recursive: true });

// The React parts of the glow run on Preact, which is bundled, so an application needs no React.
const alias = { react: 'preact/compat', 'react/jsx-runtime': 'preact/jsx-runtime' };
const entries = { index: 'src/index.ts', card: 'src/card/index.ts' };

// The library keeps onnxruntime-web as an import, so the application's bundler loads it once.
// The two entries share their chunks, so the card uses the settings of configureVoiceCapture.
await build(
  { input: entries, external: [/^onnxruntime-web/], resolve: { alias } },
  {
    dir: path.join(dist, 'esm'),
    format: 'esm',
    entryFileNames: '[name].js',
    chunkFileNames: 'chunks/[name]-[hash].js',
  },
);

// The same two entries with every dependency inside, for a page with no bundler and for the
// browser tests.
await build(
  { input: entries, resolve: { alias } },
  {
    dir: path.join(dist, 'browser'),
    format: 'esm',
    entryFileNames: '[name].js',
    chunkFileNames: 'chunks/[name]-[hash].js',
    minify: true,
  },
);

for (const fileName of [
  'silero-vad.onnx',
  'voice-activity-worklet.js',
  'NOTICE.txt',
  'SILERO_LICENSE.txt',
]) {
  await cp(path.join(root, 'assets', fileName), path.join(dist, 'assets', fileName));
}
const require = createRequire(import.meta.url);
const runtime = path.dirname(require.resolve('onnxruntime-web/wasm'));
for (const fileName of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  await cp(path.join(runtime, fileName), path.join(dist, 'assets', fileName));
}
// The example page runs from dist: `pnpm example` serves it.
await cp(path.join(root, 'example'), path.join(dist, 'example'), { recursive: true });
for (const fileName of ['hosting.mjs', 'hosting.d.mts']) {
  await cp(path.join(root, fileName), path.join(dist, fileName));
}

async function build(input, output) {
  const bundle = await rolldown(input);
  try {
    await bundle.write(output);
  } finally {
    await bundle.close();
  }
}
