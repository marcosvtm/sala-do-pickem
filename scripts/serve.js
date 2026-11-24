import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { openDb } from './local-db.js';
import { cardsApi } from '../server/api.js';
import { withSharePreview } from '../server/share-preview.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const types = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
};
const port = Number(process.env.PORT || 4173);
await mkdir(new URL('../.local/', import.meta.url), { recursive: true });
const db = openDb(
  fileURLToPath(new URL('../.local/cards.sqlite', import.meta.url))
);
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 4096) {
          res.writeHead(413);
          res.end();
          return;
        }
        chunks.push(chunk);
      }
      const api = await cardsApi(
        new Request(new URL(req.url, 'http://' + req.headers.host), {
          method: req.method,
          headers: req.headers,
          body: chunks.length ? Buffer.concat(chunks) : undefined,
        }),
        db
      );
      res.writeHead(api.status, Object.fromEntries(api.headers));
      res.end(await api.text());
      return;
    }
    if (
      ['/modelos', '/modelos/', '/partidas', '/partidas/'].includes(
        url.pathname
      )
    )
      url.pathname = '/index.html';
    if (url.pathname === '/cartoes' || url.pathname === '/cartoes/')
      url.pathname = '/cartoes.html';
    if (url.pathname === '/ranking' || url.pathname === '/ranking/')
      url.pathname = '/ranking.html';
    if (url.pathname.startsWith('/server/') || url.pathname.startsWith('/.')) {
      res.writeHead(404);
      res.end();
      return;
    }
    const file = path.resolve(
      root,
      '.' +
        decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
    );
    if (path.relative(root, file).startsWith('..'))
      throw new Error('Invalid path');
    const bytes = await readFile(file);
    res.writeHead(200, {
      'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(file.endsWith('.html')
      ? withSharePreview(bytes.toString(), new URL(req.url, 'http://' + req.headers.host))
      : bytes);
  } catch {
    res.writeHead(404);
    res.end('Recurso indisponível');
  }
});
server.listen(port, '127.0.0.1', () => console.log('http://127.0.0.1:' + port));
