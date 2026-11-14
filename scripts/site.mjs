#!/usr/bin/env node
// Starts a demo app on this machine in one step:
// - `pnpm site`: the Community Notes and spoken multisig site (`demo/frontend`, Vite on 5173).
// - `pnpm pay`: the Speak to pay page (`demo/speak-to-pay`, Vite on 5280).
//
// 1. Installs the packages of the app when they are missing, and makes .env.local from
//    .env.example when it is missing (the public settings of the demo's Seams project).
// 2. Starts each needed server when its port is free:
//    - the API (`pnpm site` with `.dev.vars` only): wrangler on http://localhost:8788. Without
//      `.dev.vars`, Vite sends `/api/*` to https://speak-to-sign.pages.dev.
//    - the page: Vite with hot reload (`--force` rebuilds Vite's package cache).
//    - HTTPS: Caddy, https://localhost:5443 → Vite. Passkeys in the Wallet iframe need HTTPS.
// 3. Prints the address to open. Ctrl+C stops the servers that it started.

import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const payMode = process.argv.includes('--pay');
const appName = payMode ? 'demo/speak-to-pay' : 'demo/frontend';
const label = payMode ? 'pay' : 'site';
const thisCommand = payMode ? 'pnpm pay' : 'pnpm site';
const otherCommand = payMode ? 'pnpm site' : 'pnpm pay';
const pagePort = payMode ? 5280 : 5173;
const otherPagePort = payMode ? 5173 : 5280;
const demo = join(root, ...appName.split('/'));

const COLORS = { api: 35, page: 36, https: 33 };
const say = (text) => console.log(`\x1b[1m[${label}]\x1b[0m ${text}`);

function hasDevVars(file) {
  if (!existsSync(file)) return false;
  return /^[^#\s=]+=\S+/m.test(readFileSync(file, 'utf8'));
}

/** True when something listens on the port (IPv4 or IPv6 localhost). */
function listening(port) {
  const on = (host) =>
    new Promise((resolve) => {
      const socket = connect({ host, port });
      socket.setTimeout(500);
      socket.once('connect', () => (socket.destroy(), resolve(true)));
      socket.once('error', () => resolve(false));
      socket.once('timeout', () => (socket.destroy(), resolve(false)));
    });
  return Promise.all([on('127.0.0.1'), on('::1')]).then(([v4, v6]) => v4 || v6);
}

async function waitFor(port, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await listening(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

function hasCommand(name) {
  return spawnSync('sh', ['-c', `command -v ${name}`], { stdio: 'ignore' }).status === 0;
}

const children = [];
let stopping = false;

/** Starts one server, with its name in front of each line of its output. */
function start(name, command, args) {
  const child = spawn(command, args, { cwd: demo, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FORCE_COLOR: '1' } });
  const tag = `\x1b[${COLORS[name]}m[${name}]\x1b[0m`;
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on('line', (line) => console.log(`${tag} ${line}`));
  }
  child.on('exit', (code) => {
    if (stopping) return;
    say(`${name} stopped (exit code ${code}). Stopping the other servers.`);
    stop(1);
  });
  children.push(child);
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

// 1. Packages.
if (!hasCommand('pnpm')) {
  say(`pnpm is missing. Run \`corepack enable\`, then \`${thisCommand}\` again.`);
  process.exit(1);
}
if (!existsSync(join(demo, 'node_modules'))) {
  say(`Installing the packages of ${appName}…`);
  const install = spawnSync('pnpm', ['install', '--frozen-lockfile'], { cwd: demo, stdio: 'inherit' });
  if (install.status !== 0) process.exit(install.status ?? 1);
}

// Public Seams settings. Both .env.example files hold the public key and environment ID of the demo project.
if (!existsSync(join(demo, '.env.local'))) {
  copyFileSync(join(demo, '.env.example'), join(demo, '.env.local'));
  say(`Made ${appName}/.env.local from .env.example: it has the public settings of the demo's Seams project.`);
}

const explicitTarget = process.env.VITE_API_TARGET?.trim() ?? '';
const localApi =
  !payMode &&
  (explicitTarget
    ? explicitTarget.includes('localhost:8788') || explicitTarget.includes('127.0.0.1:8788')
    : hasDevVars(join(demo, '.dev.vars')));

if (!payMode && !localApi) {
  say('No keys in demo/frontend/.dev.vars: Vite sends /api/* to https://speak-to-sign.pages.dev.');
}

// 2. Servers.
const https = hasCommand('caddy');
if (https && (await listening(5443)) && !(await listening(pagePort))) {
  const otherBusy = (await listening(otherPagePort)) || (payMode && (await listening(8443)));
  if (otherBusy) {
    say(`Port 5443 is in use by \`${otherCommand}\`. Stop it first (Ctrl+C), then run \`${thisCommand}\`.`);
    process.exit(1);
  }
}

const plan = [];
if (localApi) {
  plan.push({ name: 'api', port: 8788, command: 'pnpm', args: ['exec', 'wrangler', 'pages', 'dev', 'public', '--port', '8788'] });
}
plan.push({
  name: 'page',
  port: pagePort,
  command: 'pnpm',
  args: ['exec', 'vite', '--port', String(pagePort), '--strictPort', '--force'],
});
if (https) plan.push({ name: 'https', port: 5443, command: 'caddy', args: ['run', '--config', 'Caddyfile', '--adapter', 'caddyfile'] });

for (const server of plan) {
  if (await listening(server.port)) say(`${server.name}: port ${server.port} is in use, so the server that runs there stays.`);
  else start(server.name, server.command, server.args);
}

// 3. Ready.
const ready = await Promise.all(plan.map((server) => waitFor(server.port, 60_000)));
if (stopping) process.exit(1);
plan.forEach((server, index) => {
  if (!ready[index]) say(`${server.name} did not open port ${server.port} within 60 s. Read its lines above.`);
});
if (https) {
  say('Open \x1b[1mhttps://localhost:5443\x1b[0m (first time on this machine: run `caddy trust` once).');
} else {
  say(
    `Open \x1b[1mhttp://localhost:${pagePort}\x1b[0m. To sign in with a passkey, install Caddy (\`brew install caddy\`, then \`caddy trust\`) and run \`${thisCommand}\` again.`,
  );
}
if (children.length === 0) {
  say('All servers ran already. Nothing to stop.');
  process.exit(0);
}
say('Ctrl+C stops the servers that this command started.');
