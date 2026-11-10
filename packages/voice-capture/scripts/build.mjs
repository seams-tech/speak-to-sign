import { rolldown } from 'rolldown';
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = path.join(root, 'dist');
process.chdir(root);
await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'assets'), { recursive: true });

// The React parts of the glow run on Preact, so an application needs no React.
const alias = { react: 'preact/compat', 'react/jsx-runtime': 'preact/jsx-runtime' };
const entries = { index: 'src/index.ts', card: 'src/card/index.ts' };

// The library keeps onnxruntime-web and Preact as imports, so the application's bundler loads
// each of them once. Each source file is one output file, so that bundler takes only the files
// that the application uses, and can load the phrase card later than the prompt.
const modules = {};
for (const file of await readdir(path.join(root, 'src'), { recursive: true })) {
  if (file.endsWith('.ts')) modules[file.slice(0, -'.ts'.length)] = path.join('src', file);
}
await build(
  {
    input: modules,
    external: [/^onnxruntime-web/, /^preact/],
    plugins: [{ name: 'react-on-preact', resolveId: preactImport }],
  },
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

/** In the library, an import of React becomes an import of Preact that stays outside. */
function preactImport(source) {
  return Object.hasOwn(alias, source) ? { id: alias[source], external: true } : null;
}
