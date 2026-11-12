// Builds the site for a deploy into dist/: the Community Notes page at / and the spoken
// multisig at /multisig/ (one Vite build, two HTML pages). It stops when the Seams key is
// missing, because a site built without the key cannot reach the Wallet.
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';

const demo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const seamsEnv = loadEnv('production', demo, 'VITE_SEAMS_');
if (!seamsEnv.VITE_SEAMS_PUBLISHABLE_KEY) {
  console.error('VITE_SEAMS_PUBLISHABLE_KEY is not set. Put it in demo/frontend/.env.production.local or demo/frontend/.env.local.');
  process.exit(1);
}

const result = spawnSync('pnpm', ['exec', 'vite', 'build'], { cwd: demo, stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('Site built: dist/ (Community Notes at /, the spoken multisig at /multisig/).');
