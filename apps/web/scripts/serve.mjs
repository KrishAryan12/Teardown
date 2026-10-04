// Minimal static server for the exported site (out/). Used by the a11y check and local previews.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const ROOT = fileURLToPath(new URL('../out/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain', '.xml': 'application/xml', '.ico': 'image/x-icon' };

export function serve(port = 3000) {
  const server = http.createServer(async (req, res) => {
    let path = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT.replace(/[\\/]$/, '') + sep) && file + sep !== ROOT) {
      res.writeHead(403).end();
      return;
    }
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    } catch {
      file = join(ROOT, '404.html');
      res.statusCode = 404;
    }
    try {
      let body = await readFile(file);
      const type = TYPES[extname(file)] ?? 'application/octet-stream';
      const headers = { 'content-type': type, 'cache-control': path.startsWith('/_next/static/') ? 'public, max-age=31536000, immutable' : 'no-cache' };
      if (/text|javascript|json|svg|xml/.test(type) && /gzip/.test(req.headers['accept-encoding'] ?? '')) {
        body = zlib.gzipSync(body);
        headers['content-encoding'] = 'gzip';
      }
      res.writeHead(res.statusCode || 200, headers).end(body);
    } catch {
      res.writeHead(404).end('Not found');
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT ?? 3000);
  await serve(port);
  console.log(`serving out/ on http://localhost:${port}`);
}
