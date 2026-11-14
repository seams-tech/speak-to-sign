// Builds the site for a deploy into dist/: the Community Notes page at / and the spoken
// multisig at /multisig/ (one Vite build, two HTML pages). It stops when the Seams settings are
// missing, because a site built without them cannot register or reach a Wallet.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';

const demo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

if (
  !existsSync(join(demo, '.env.production.local')) &&
  !existsSync(join(demo, '.env.local')) &&
  existsSync(join(demo, '.env.example'))
) {
  copyFileSync(join(demo, '.env.example'), join(demo, '.env.local'));
}

const seamsEnv = loadEnv('production', demo, 'VITE_SEAMS_');
if (!seamsEnv.VITE_SEAMS_PUBLISHABLE_KEY || !seamsEnv.VITE_SEAMS_PROJECT_ENVIRONMENT_ID) {
  console.error(
    'VITE_SEAMS_PUBLISHABLE_KEY and VITE_SEAMS_PROJECT_ENVIRONMENT_ID must be set in demo/frontend/.env.production.local or demo/frontend/.env.local.',
  );
  process.exit(1);
}

const result = spawnSync('pnpm', ['exec', 'vite', 'build'], { cwd: demo, stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('Site built: dist/ (Community Notes at /, the spoken multisig at /multisig/).');
