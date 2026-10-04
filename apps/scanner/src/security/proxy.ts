import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import type { SsrfGuard } from './guard';

/**
 * Local SSRF-guarding forward proxy. All Chromium traffic (Playwright and Lighthouse) is routed
 * through it with `--proxy-server` and `--proxy-bypass-list=<-loopback>`.
 *
 * - Plain HTTP: absolute-form requests are validated and forwarded with `guard.lookup`, so the
 *   upstream socket only ever connects to an address the guard approved.
 * - HTTPS / WSS: `CONNECT host:port` is validated, then a raw TCP tunnel is opened to the
 *   validated IP. TLS is never terminated or decrypted here.
 * - Anything else (origin-form requests, upgrades) is refused.
 */
export interface GuardProxy {
  url: string;
  port: number;
  /** Number of refused requests since start (handy in tests and logs). */
  blockedCount(): number;
  close(): Promise<void>;
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export async function startGuardProxy(guard: SsrfGuard, opts: { connectTimeoutMs?: number } = {}): Promise<GuardProxy> {
  const connectTimeout = opts.connectTimeoutMs ?? 15_000;
  let blocked = 0;
  const sockets = new Set<net.Socket | Duplex>();

  const refuse = (res: http.ServerResponse, status = 403) => {
    blocked++;
    if (!res.headersSent) res.writeHead(status, { 'content-type': 'text/plain', connection: 'close' });
    res.end('Blocked by Teardown SSRF guard');
  };

  const server = http.createServer((req, res) => {
    let target: URL;
    try {
      target = new URL(req.url ?? '');
    } catch {
      return refuse(res, 400);
    }
    if (target.protocol !== 'http:') return refuse(res, 400);
    guard
      .assertUrl(target)
      .then(() => {
        const headers: http.OutgoingHttpHeaders = {};
        for (const [k, v] of Object.entries(req.headers)) if (!HOP_BY_HOP.has(k.toLowerCase())) headers[k] = v;
        const upstream = http.request(
          target,
          { method: req.method, headers, lookup: guard.lookup as never, agent: false, timeout: connectTimeout },
          (up) => {
            const outHeaders: http.OutgoingHttpHeaders = {};
            for (const [k, v] of Object.entries(up.headers)) if (!HOP_BY_HOP.has(k.toLowerCase())) outHeaders[k] = v;
            res.writeHead(up.statusCode ?? 502, outHeaders);
            up.pipe(res);
          },
        );
        upstream.on('timeout', () => upstream.destroy(new Error('upstream timeout')));
        upstream.on('error', (e: NodeJS.ErrnoException) => {
          if (e.code === 'EBLOCKED') return refuse(res);
          if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
          res.end();
        });
        req.pipe(upstream);
      })
      .catch(() => refuse(res));
  });

  server.on('connect', (req: http.IncomingMessage, client: Duplex, head: Buffer) => {
    sockets.add(client);
    client.on('close', () => sockets.delete(client));
    client.on('error', () => client.destroy());
    const deny = (line = '403 Forbidden') => {
      blocked++;
      client.end(`HTTP/1.1 ${line}\r\nConnection: close\r\n\r\n`);
    };
    const m = /^\[?([^\]]+?)\]?:(\d{1,5})$/.exec(req.url ?? '');
    if (!m) return deny('400 Bad Request');
    const host = m[1]!;
    const port = Number(m[2]);
    try {
      guard.assertPort(port);
    } catch {
      return deny();
    }
    guard
      .resolve(host)
      .then((addrs) => {
        const addr = addrs[0]!;
        const upstream = net.connect({ host: addr.address, port, family: addr.family, timeout: connectTimeout });
        sockets.add(upstream);
        upstream.once('connect', () => {
          upstream.setTimeout(0);
          client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          if (head?.length) upstream.write(head);
          upstream.pipe(client);
          client.pipe(upstream);
        });
        upstream.on('timeout', () => upstream.destroy());
        upstream.on('error', () => {
          if (client.writable) client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        });
        upstream.on('close', () => {
          sockets.delete(upstream);
          client.destroy();
        });
      })
      .catch(() => deny());
  });

  // WebSocket upgrades over plain HTTP are refused outright; wss goes through CONNECT above.
  server.on('upgrade', (_req, socket: Duplex) => {
    blocked++;
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  });

  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    blockedCount: () => blocked,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}
