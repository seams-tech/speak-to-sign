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

// The library keeps onnxruntime-web as an import, so the application's bundler loads it once.
await build(
  { input: ['src/index.ts'], external: [/^onnxruntime-web/] },
  { dir: path.join(dist, 'esm'), format: 'esm', preserveModules: true, preserveModulesRoot: 'src' },
);

// One file for a page with no bundler, and for the browser test.
await build(
  { input: { 'voice-capture': 'src/index.ts' } },
  { dir: path.join(dist, 'browser'), format: 'esm', entryFileNames: '[name].js', minify: true },
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
