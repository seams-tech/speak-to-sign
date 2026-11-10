// Builds the whole site into dist/: the Speak-to-Sign page at / (with Community Notes and the
// voice multisig in its windows), then the Speak to pay example (../../examples/speak-to-pay) at /pay/.
// All use one Seams project, so the
// pay build gets the VITE_SEAMS_* settings of demo/frontend/ (.env.local, .env.production.local, or the
// environment). Nothing is written into examples/.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';

const demo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pay = resolve(demo, '../../examples/speak-to-pay');

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const seamsEnv = loadEnv('production', demo, 'VITE_SEAMS_');
if (!seamsEnv.VITE_SEAMS_PUBLISHABLE_KEY) {
  console.error('VITE_SEAMS_PUBLISHABLE_KEY is not set. Put it in demo/frontend/.env.production.local or demo/frontend/.env.local.');
  process.exit(1);
}
if (!existsSync(resolve(pay, 'node_modules'))) {
  console.error(`Run "pnpm install" in ${pay} first.`);
  process.exit(1);
}

run('pnpm', ['exec', 'vite', 'build'], demo);
run('pnpm', ['exec', 'vite', 'build', '--base', '/pay/', '--outDir', resolve(demo, 'dist/pay'), '--emptyOutDir'], pay, {
  ...process.env,
  ...seamsEnv,
});
console.log('Site built: dist/ (Speak-to-Sign at /, with Community Notes and the voice multisig in its windows) and dist/pay/ (Speak to pay at /pay/).');
