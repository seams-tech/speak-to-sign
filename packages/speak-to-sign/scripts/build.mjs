import { rolldown } from 'rolldown';
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = path.join(root, 'dist');
process.chdir(root);
await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'public/sdk/speak-to-sign'), { recursive: true });

// The descriptor and React entries import only types from @seams/wallet.
await build(
  { input: ['src/index.ts', 'src/react.ts'] },
  { dir: path.join(dist, 'esm'), format: 'esm', preserveModules: true, preserveModulesRoot: 'src' },
);

// The Wallet host loads this file from /sdk/speak-to-sign/host.js on first use.
await build(
  { input: { host: 'src/host.ts' } },
  {
    dir: path.join(dist, 'public/sdk/speak-to-sign'),
    format: 'esm',
    entryFileNames: '[name].js',
    chunkFileNames: '[name]-[hash].js',
    minify: true,
  },
);

for (const filename of ['hosting.mjs', 'hosting.d.mts']) {
  await cp(path.join(root, filename), path.join(dist, filename));
}
await cp(path.join(root, 'scripts/compose-host.mjs'), path.join(dist, 'compose-host.mjs'));

async function build(input, output) {
  const bundle = await rolldown(input);
  try {
    await bundle.write(output);
  } finally {
    await bundle.close();
  }
}
