#!/usr/bin/env node
// `pnpm site`: starts the demo site on this machine in one step.
//
// 1. Installs the packages of demo/frontend when they are missing.
// 2. Starts three servers, each only when its port is free (a server that runs already is used):
//    - the API: the Pages Functions with wrangler, http://localhost:8788
//    - the page: Vite with hot reload, http://localhost:5173 (sends /api/* to 8788). `--force`
//      builds Vite's package cache again, so a new SDK version is always the one that runs.
//    - HTTPS: Caddy, https://localhost:5443 → 5173. Passkeys in the Wallet iframe need HTTPS.
// 3. Prints the address to open. Ctrl+C stops the servers that it started.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const demo = join(root, 'demo', 'frontend');

const COLORS = { api: 35, page: 36, https: 33 };
const say = (text) => console.log(`\x1b[1m[site]\x1b[0m ${text}`);

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
  say('pnpm is missing. Run `corepack enable`, then `pnpm site` again.');
  process.exit(1);
}
if (!existsSync(join(demo, 'node_modules'))) {
  say('Installing the packages of demo/frontend…');
  const install = spawnSync('pnpm', ['install', '--frozen-lockfile'], { cwd: demo, stdio: 'inherit' });
  if (install.status !== 0) process.exit(install.status ?? 1);
}

// Keys. The site starts without them, with less to do.
if (!existsSync(join(demo, '.env.local'))) {
  say('No demo/frontend/.env.local: the page cannot reach the Seams Wallet. Copy .env.example and set VITE_SEAMS_PUBLISHABLE_KEY.');
}
if (!existsSync(join(demo, '.dev.vars'))) {
  say('No demo/frontend/.dev.vars: the API runs without its keys (no X posts, no JEV). Copy .dev.vars.example to set them.');
}

// 2. Servers.
const plan = [
  { name: 'api', port: 8788, command: 'pnpm', args: ['exec', 'wrangler', 'pages', 'dev', 'public', '--port', '8788'] },
  { name: 'page', port: 5173, command: 'pnpm', args: ['exec', 'vite', '--port', '5173', '--strictPort', '--force'] },
];
const https = hasCommand('caddy');
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
  say('Open \x1b[1mhttp://localhost:5173\x1b[0m. To sign in with a passkey, install Caddy (`brew install caddy`, then `caddy trust`) and run `pnpm site` again.');
}
if (children.length === 0) {
  say('All servers ran already. Nothing to stop.');
  process.exit(0);
}
say('Ctrl+C stops the servers that this command started.');
