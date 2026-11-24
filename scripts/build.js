import { build } from 'esbuild';
import { readdir, readFile, mkdir } from 'node:fs/promises';
import { extname } from 'node:path';
const publicRoot = new URL('../dist/', import.meta.url);
const assets = {};
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};
async function collect(dir = '') {
  for (const file of await readdir(new URL(dir, publicRoot), {
    withFileTypes: true,
  })) {
    if (file.name.startsWith('.') || file.name === 'server') continue;
    const name = dir + file.name;
    if (file.isDirectory()) await collect(name + '/');
    else if (mime[extname(name)])
      assets['/' + name] = [
        mime[extname(name)],
        (await readFile(new URL(name, publicRoot))).toString('base64'),
      ];
  }
}
await collect();
await mkdir(new URL('server/', publicRoot), { recursive: true });
await build({
  entryPoints: ['server/worker.js'],
  outfile: 'dist/server/index.js',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  define: { PUBLIC_FILES: JSON.stringify(assets) },
});
