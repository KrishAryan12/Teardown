import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
};

export const FIXTURES_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../fixtures/pages');

export interface FixtureServer {
  origin: string;
  close(): Promise<void>;
}

/** Serves a fixtures directory on 127.0.0.1 with no compression (so "uncompressed text" rules fire). */
export async function startFixtureServer(root = FIXTURES_DIR): Promise<FixtureServer> {
  const base = resolve(root);
  const server = http.createServer(async (req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]!);
    if (path === '/redirect-me') {
      res.writeHead(301, { location: '/good.html' });
      return res.end();
    }
    let file = normalize(join(base, path));
    if (!file.startsWith(base + sep) && file !== base) {
      res.writeHead(403);
      return res.end();
    }
    try {
      const s = await stat(file);
      if (s.isDirectory()) file = join(file, 'index.html');
      let body: Buffer | string = await readFile(file);
      // Sitemaps and robots.txt need absolute URLs; the port is only known at runtime.
      if (/\.(xml|txt)$/.test(file)) body = body.toString('utf8').replaceAll('{{origin}}', `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end('<!doctype html><title>Not found</title><h1>Not found</h1>');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
