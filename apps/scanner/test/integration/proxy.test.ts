import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SsrfGuard } from '../../src/security/guard';
import { startGuardProxy, type GuardProxy } from '../../src/security/proxy';
import { playwrightLaunchOptions } from '../../src/browser/launchOptions';

/**
 * Chromium launched through the guard proxy (strict policy, as in production) must not reach
 * loopback, private-range or metadata addresses over HTTP or HTTPS, for navigations or sub-requests.
 */
describe('SSRF-guarding proxy with Chromium', () => {
  let proxy: GuardProxy;
  let browser: Browser;
  let target: http.Server;
  let port: number;
  let hits = 0;
  const SECRET = 'INTERNAL-SECRET-7731';

  beforeAll(async () => {
    target = http.createServer((_req, res) => {
      hits++;
      res.writeHead(200, { 'content-type': 'text/html', 'access-control-allow-origin': '*' });
      res.end(`<html><body>${SECRET}</body></html>`);
    });
    await new Promise<void>((r) => target.listen(0, '0.0.0.0', r));
    port = (target.address() as AddressInfo).port;
    proxy = await startGuardProxy(new SsrfGuard({ allowPrivate: false }), { connectTimeoutMs: 3000 });
    browser = await chromium.launch(playwrightLaunchOptions(proxy.url, true));
  });

  afterAll(async () => {
    await browser?.close();
    await proxy?.close();
    await new Promise<void>((r) => target.close(() => r()));
  });

  const targets = () => [
    `http://127.0.0.1:${port}/`,
    `http://localhost:${port}/`,
    `http://[::1]:${port}/`,
    `http://2130706433:${port}/`,
    `http://127.0.0.1/`,
    `https://127.0.0.1/`,
    `https://localhost:${port}/`,
    'http://169.254.169.254/latest/meta-data/',
    'https://169.254.169.254/',
    'http://10.0.0.1/',
    'https://192.168.1.1/',
    'http://[fd00::1]/',
  ];

  it.skipIf(process.env.OFFLINE === '1')('still loads public HTTPS and HTTP pages through the proxy', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const res = await page.goto('https://example.com/', { timeout: 20_000 });
    expect(res?.status()).toBe(200);
    expect(await page.title()).toMatch(/example/i);
    const plain = await page.goto('http://example.com/', { timeout: 20_000 });
    expect(plain?.ok()).toBe(true);
    await ctx.close();
  });

  it('blocks navigations to internal addresses', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    for (const url of targets()) {
      let body = '';
      let status = 0;
      try {
        const res = await page.goto(url, { timeout: 8000 });
        status = res?.status() ?? 0;
        body = await page.content();
      } catch {
        // net::ERR_TUNNEL_CONNECTION_FAILED / ERR_PROXY_CONNECTION_FAILED etc: blocked.
      }
      expect(body, url).not.toContain(SECRET);
      expect([0, 400, 403, 502], url).toContain(status);
    }
    await ctx.close();
    expect(hits).toBe(0);
  });

  it('blocks sub-requests (img, fetch, iframe) to internal addresses', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const internal = `http://127.0.0.1:${port}`;
    await page.setContent(
      `<img src="${internal}/img.png"><iframe src="${internal}/frame"></iframe><link rel="stylesheet" href="${internal}/s.css">`,
    );
    const fetched = await page.evaluate(async (u) => {
      try {
        const r = await fetch(u + '/api');
        return await r.text();
      } catch {
        return 'blocked';
      }
    }, internal);
    expect(fetched).not.toContain(SECRET);
    await page.waitForTimeout(500);
    await ctx.close();
    expect(hits).toBe(0);
  });

  it('refuses CONNECT to non-allowed ports and internal hosts at the proxy itself', async () => {
    const before = proxy.blockedCount();
    const connect = (path: string) =>
      new Promise<number>((resolve) => {
        const req = http.request({ host: '127.0.0.1', port: proxy.port, method: 'CONNECT', path });
        req.on('connect', (res, socket) => {
          socket.destroy();
          resolve(res.statusCode ?? 0);
        });
        req.on('error', () => resolve(0));
        req.end();
      });
    expect(await connect('example.com:22')).toBe(403);
    expect(await connect(`127.0.0.1:${port}`)).toBe(403);
    expect(await connect('169.254.169.254:443')).toBe(403);
    expect(proxy.blockedCount()).toBeGreaterThan(before);
  });
});
