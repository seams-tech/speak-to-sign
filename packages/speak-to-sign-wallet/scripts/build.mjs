import { rolldown } from 'rolldown';
import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = path.join(root, 'dist');
// The Wallet host serves /sdk/speak-to-sign-host.js at a fixed path with a long cache life, while
// this plugin's hashed chunks load fresh after a deploy. Each import of it carries the one Wallet
// version this plugin pins, which is also the Wallet's asset version, so a new chunk never runs
// against a cached older bridge.
const walletVersion = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  .peerDependencies['@seams/wallet'];
if (!/^\d+\.\d+\.\d+$/.test(walletVersion)) {
  throw new Error(
    `@seams/speak-to-sign-wallet must pin one exact @seams/wallet version, not ${walletVersion}`,
  );
}
process.chdir(root);
await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'public/sdk/speak-to-sign'), { recursive: true });

// The descriptor entry imports only types from @seams/wallet.
await build(
  { input: ['src/index.ts'] },
  { dir: path.join(dist, 'esm'), format: 'esm', preserveModules: true, preserveModulesRoot: 'src' },
);

// The Wallet host loads this file from /sdk/speak-to-sign/host.js on first use. The flow
// chunk loads when a payment starts. It shares the Wallet's /sdk/speak-to-sign-host.js and
// records through Wallet core, which asks the VoiceID host plugin for the clip.
await build(
  {
    input: { host: 'src/host.ts' },
    external: ['@seams/wallet/speak-to-sign-host'],
  },
  {
    dir: path.join(dist, 'public/sdk/speak-to-sign'),
    format: 'esm',
    entryFileNames: '[name].js',
    chunkFileNames: '[name]-[hash].js',
    minify: true,
    paths: { '@seams/wallet/speak-to-sign-host': `../speak-to-sign-host.js?v=${walletVersion}` },
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
