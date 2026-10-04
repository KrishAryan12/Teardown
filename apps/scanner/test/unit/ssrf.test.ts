import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { LookupAddress } from 'node:dns';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { blockedReason, isBlockedIp } from '../../src/security/ip';
import { normalizeUrl, SsrfGuard } from '../../src/security/guard';
import { safeFetch } from '../../src/security/safeFetch';
import { ScanError } from '../../src/errors';

const fakeDns =
  (table: Record<string, string[]>) =>
  async (host: string): Promise<LookupAddress[]> => {
    const ips = table[host];
    if (!ips) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
    return ips.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  };

const strict = (table: Record<string, string[]> = {}) =>
  new SsrfGuard({ allowPrivate: false, resolver: fakeDns({ 'example.com': ['93.184.215.14'], ...table }) });

async function expectCode(p: Promise<unknown> | (() => unknown), code: string) {
  try {
    await (typeof p === 'function' ? p() : p);
  } catch (e) {
    expect(e).toBeInstanceOf(ScanError);
    expect((e as ScanError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}, but it resolved`);
}

describe('blockedReason (address policy)', () => {
  it.each([
    '127.0.0.1',
    '127.255.255.254',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '169.254.0.1',
    '100.64.0.1', // CGNAT
    '0.0.0.0',
    '224.0.0.1',
    '239.255.255.250',
    '240.0.0.1',
    '255.255.255.255',
    '198.18.0.1',
    '192.0.2.1',
    '::1',
    '::',
    'fc00::1',
    'fd12:3456::1', // unique local
    'fe80::1', // link-local
    'fe80::1%eth0',
    'ff02::1',
    '::ffff:127.0.0.1', // IPv4-mapped loopback
    '::ffff:7f00:1',
    '::ffff:169.254.169.254',
    '::ffff:10.0.0.1',
    '64:ff9b::a9fe:a9fe', // NAT64 of metadata
    '2002:7f00:1::', // 6to4 of loopback
    '2001:db8::1',
    '[::1]',
  ])('blocks %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each(['93.184.215.14', '8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '2001:4860:4860::8888'])('allows public %s', (ip) => {
    expect(blockedReason(ip)).toBeNull();
  });
});

describe('normalizeUrl', () => {
  it('adds https and strips fragments', () => {
    expect(normalizeUrl('Example.COM/path#frag').toString()).toBe('https://example.com/path');
  });
  it('converts IDNs to punycode', () => {
    expect(normalizeUrl('https://bücher.example/').hostname).toBe('xn--bcher-kva.example');
  });
  it('rejects credentials', async () => {
    await expectCode(() => normalizeUrl('https://user:pass@example.com/'), 'INVALID_URL');
  });
  it.each(['file:///etc/passwd', 'data:text/html,<h1>x</h1>', 'javascript:alert(1)', 'ftp://example.com/', 'gopher://x', 'blob:https://example.com/x'])(
    'rejects %s',
    async (u) => {
      await expectCode(() => normalizeUrl(u), 'INVALID_URL');
    },
  );
  it('rejects empty and whitespace', async () => {
    await expectCode(() => normalizeUrl('   '), 'INVALID_URL');
    await expectCode(() => normalizeUrl('exa mple.com'), 'INVALID_URL');
  });
});

describe('SsrfGuard.assertUrl', () => {
  const g = strict({
    'internal.example': ['10.0.0.5'],
    'mixed.example': ['93.184.215.14', '192.168.0.10'],
    'v6only.example': ['::1'],
    'metadata.example': ['169.254.169.254'],
    'mapped.example': ['::ffff:127.0.0.1'],
  });

  it('allows a public host', async () => {
    await expect(g.assertUrl(normalizeUrl('https://example.com/'))).resolves.toHaveLength(1);
  });

  it.each([
    'http://127.0.0.1/',
    'http://localhost/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:7f00:1]/',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.1/',
    'http://192.168.0.1/',
    'http://172.16.0.1/',
    'http://0.0.0.0/',
    // Alternate IPv4 encodings, canonicalised by the WHATWG URL parser.
    'http://2130706433/', // decimal
    'http://0x7f000001/', // hex
    'http://0x7f.0.0.1/', // hex octet
    'http://0177.0.0.1/', // octal
    'http://017700000001/', // octal integer
    'http://127.1/', // short form
    'http://0/', // 0.0.0.0
    'http://intranet/', // single label
    'http://printer.local/',
  ])('blocks %s', async (u) => {
    await expectCode(g.assertUrl(normalizeUrl(u)), 'BLOCKED_TARGET');
  });

  it.each(['internal.example', 'mixed.example', 'v6only.example', 'metadata.example', 'mapped.example'])(
    'blocks names resolving to private addresses: %s',
    async (host) => {
      await expectCode(g.assertUrl(normalizeUrl(`https://${host}/`)), 'BLOCKED_TARGET');
    },
  );

  it.each(['https://example.com:8080/', 'http://example.com:22/', 'https://example.com:8443/', 'http://example.com:6379/'])(
    'blocks non-standard ports: %s',
    async (u) => {
      await expectCode(g.assertUrl(normalizeUrl(u)), 'BLOCKED_TARGET');
    },
  );

  it('allows explicit default ports', async () => {
    await expect(g.assertUrl(normalizeUrl('https://example.com:443/'))).resolves.toBeDefined();
    await expect(g.assertUrl(normalizeUrl('http://example.com:80/'))).resolves.toBeDefined();
  });

  it('reports unknown domains as unreachable', async () => {
    await expectCode(g.assertUrl(normalizeUrl('https://no-such-host.example/')), 'UNREACHABLE');
  });

  it('lookup never hands out a blocked address', async () => {
    const err = await new Promise<NodeJS.ErrnoException | null>((resolve) =>
      g.lookup('internal.example', {}, (e) => resolve(e)),
    );
    expect(err?.code).toBe('EBLOCKED');
  });

  it('pins resolutions so a rebinding answer is not used within the pin window', async () => {
    let answer = '93.184.215.14';
    const guard = new SsrfGuard({ allowPrivate: false, resolver: async () => [{ address: answer, family: 4 }] });
    await guard.assertUrl(normalizeUrl('https://rebind.example/'));
    answer = '127.0.0.1';
    const addrs = await guard.resolve('rebind.example');
    expect(addrs[0]!.address).toBe('93.184.215.14');
  });
});

describe('safeFetch redirects', () => {
  let server: http.Server;
  let port: number;
  // Only the local test server (127.0.0.1) is treated as "public" here. Everything else uses the real policy.
  const guard = () =>
    new SsrfGuard({
      allowPrivate: false,
      allowedPorts: [80, 443, port],
      resolver: fakeDns({ 'start.example': ['127.0.0.1'], 'internal.example': ['10.0.0.5'] }),
      isBlocked: (ip) => (ip === '127.0.0.1' ? false : blockedReason(ip) !== null),
    });

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const map: Record<string, string> = {
        '/to-metadata': 'http://169.254.169.254/latest/meta-data/',
        '/to-private-name': 'http://internal.example/',
        '/to-loopback-v6': 'http://[::1]/',
        '/to-port': `http://start.example:6379/`,
        '/to-file': 'file:///etc/passwd',
        '/loop': '/loop',
        '/ok-redirect': '/ok',
      };
      const loc = map[req.url ?? ''];
      if (loc) {
        res.writeHead(302, { location: loc });
        return res.end();
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><title>ok</title></html>');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('follows a safe redirect', async () => {
    const res = await safeFetch(`http://start.example:${port}/ok-redirect`, { guard: guard() });
    expect(res.status).toBe(200);
    expect(res.redirects).toHaveLength(1);
    expect(res.body.toString()).toContain('ok');
  });

  it.each(['/to-metadata', '/to-private-name', '/to-loopback-v6', '/to-port', '/to-file'])('blocks a redirect %s', async (path) => {
    await expectCode(safeFetch(`http://start.example:${port}${path}`, { guard: guard() }), 'BLOCKED_TARGET');
  });

  it('caps redirect chains at 5', async () => {
    await expectCode(safeFetch(`http://start.example:${port}/loop`, { guard: guard() }), 'UNREACHABLE');
  });

  it('refuses non-HTML when HTML is required', async () => {
    const s = http.createServer((_q, r) => {
      r.writeHead(200, { 'content-type': 'application/pdf' });
      r.end('%PDF');
    });
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
    const p = (s.address() as AddressInfo).port;
    const g = new SsrfGuard({ allowPrivate: true });
    await expectCode(safeFetch(`http://127.0.0.1:${p}/`, { guard: g, requireHtml: true }), 'NOT_HTML');
    await new Promise<void>((r) => s.close(() => r()));
  });

  it('truncates bodies over the byte cap', async () => {
    const s = http.createServer((_q, r) => {
      r.writeHead(200, { 'content-type': 'text/html' });
      r.end('x'.repeat(50_000));
    });
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
    const p = (s.address() as AddressInfo).port;
    const res = await safeFetch(`http://127.0.0.1:${p}/`, { guard: new SsrfGuard({ allowPrivate: true }), maxBytes: 1000 });
    expect(res.truncated).toBe(true);
    expect(res.body.length).toBe(1000);
    await new Promise<void>((r) => s.close(() => r()));
  });
});
