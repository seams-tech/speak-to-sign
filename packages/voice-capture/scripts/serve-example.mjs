// Serves the built package for the example page: http://localhost:4599/example/
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
};
const port = Number(process.env.PORT ?? 4599);

createServer(async (request, response) => {
  let pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = path.join(dist, path.normalize(pathname));
  if (!file.startsWith(dist)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const bytes = await readFile(file);
    response.setHeader('Content-Type', TYPES[path.extname(file)] ?? 'application/octet-stream');
    response.end(bytes);
  } catch {
    response.writeHead(404).end();
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`voice-capture example: http://localhost:${port}/example/`);
});
