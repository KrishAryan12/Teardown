import { promises as dns } from 'node:dns';
import type { LookupAddress, LookupOptions } from 'node:dns';
import { ScanError } from '../errors';
import { blockedReason, isIpLiteral } from './ip';

export interface GuardOptions {
  /** Dev/test only: allow private, loopback and non-standard ports. */
  allowPrivate: boolean;
  allowedPorts?: number[];
  /** How long a validated resolution is pinned for a host (ms). */
  pinTtlMs?: number;
  /** Injectable resolver for tests. */
  resolver?: (host: string) => Promise<LookupAddress[]>;
  /** Injectable address policy for tests. Defaults to the strict public-unicast policy. */
  isBlocked?: (address: string) => boolean;
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

const NON_HTTP_SCHEMES = /^(file|data|javascript|blob|ftp|ftps|mailto|about|chrome|chrome-extension|view-source|ws|wss|gopher|dict|ldap|smb|ssh|tel|vbscript|filesystem|jar):/i;

/**
 * Normalises user input into an http(s) URL string or throws INVALID_URL.
 * Adds https:// when the scheme is missing, lowercases the host, converts IDNs to punycode
 * (WHATWG URL does this), canonicalises numeric IPv4 forms, strips the fragment and
 * rejects embedded credentials.
 */
export function normalizeUrl(input: string): URL {
  const raw = input.trim();
  if (!raw || raw.length > 2048 || /\s/.test(raw)) throw new ScanError('INVALID_URL');
  let candidate = raw;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
    if (NON_HTTP_SCHEMES.test(candidate)) throw new ScanError('INVALID_URL', 'Only http and https addresses can be scanned.');
    candidate = `https://${candidate}`;
  }
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new ScanError('INVALID_URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ScanError('INVALID_URL', 'Only http and https addresses can be scanned.');
  }
  if (url.username || url.password) {
    throw new ScanError('INVALID_URL', 'Remove the username and password from the address. Teardown scans public pages only.');
  }
  if (!url.hostname) throw new ScanError('INVALID_URL');
  url.hash = '';
  return url;
}

export class SsrfGuard {
  readonly allowPrivate: boolean;
  private readonly ports: Set<number>;
  private readonly pinTtl: number;
  private readonly resolver: (host: string) => Promise<LookupAddress[]>;
  private readonly pins = new Map<string, { addrs: LookupAddress[]; expires: number }>();
  private readonly blocked: (address: string) => boolean;

  constructor(opts: GuardOptions) {
    this.allowPrivate = opts.allowPrivate;
    this.ports = new Set(opts.allowedPorts ?? [80, 443]);
    this.pinTtl = opts.pinTtlMs ?? 60_000;
    this.resolver = opts.resolver ?? ((host) => dns.lookup(host, { all: true, verbatim: true }));
    this.blocked = opts.isBlocked ?? ((a) => blockedReason(a) !== null);
  }

  effectivePort(url: URL): number {
    if (url.port) return Number(url.port);
    return url.protocol === 'https:' ? 443 : 80;
  }

  assertPort(port: number): void {
    if (this.allowPrivate) return;
    if (!this.ports.has(port)) {
      throw new ScanError('BLOCKED_TARGET', `Port ${port} isn't allowed. Teardown only scans sites on ports 80 and 443.`);
    }
  }

  /** Syntactic checks for any URL we are about to fetch or let Chromium fetch. */
  assertUrlShape(url: URL): void {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ScanError('BLOCKED_TARGET', `Scheme ${url.protocol} is blocked.`);
    if (url.username || url.password) throw new ScanError('BLOCKED_TARGET', 'URLs with credentials are blocked.');
    this.assertPort(this.effectivePort(url));
    const host = url.hostname;
    if (!this.allowPrivate) {
      if (isIpLiteral(host)) {
        if (this.blocked(host)) throw new ScanError('BLOCKED_TARGET');
      } else if (!host.includes('.') || /\.(localhost|local|internal|intranet|lan|home|corp|localdomain)$/i.test(host) || host === 'localhost') {
        throw new ScanError('BLOCKED_TARGET');
      }
    }
  }

  /**
   * Resolves a hostname and validates every address. Any blocked address blocks the host
   * (a name that resolves to both public and private addresses is refused).
   * Results are pinned for `pinTtlMs` so later connections use the same validated addresses.
   */
  async resolve(host: string): Promise<LookupAddress[]> {
    const h = host.replace(/^\[|\]$/g, '').toLowerCase();
    if (isIpLiteral(h)) {
      if (!this.allowPrivate && this.blocked(h)) throw new ScanError('BLOCKED_TARGET');
      return [{ address: h, family: h.includes(':') ? 6 : 4 }];
    }
    const pinned = this.pins.get(h);
    if (pinned && pinned.expires > Date.now()) return pinned.addrs;
    let addrs: LookupAddress[];
    try {
      addrs = await this.resolver(h);
    } catch {
      throw new ScanError('UNREACHABLE', "Teardown couldn't find that domain. Check the spelling.");
    }
    if (!addrs.length) throw new ScanError('UNREACHABLE', "Teardown couldn't find that domain. Check the spelling.");
    if (!this.allowPrivate) {
      for (const a of addrs) {
        if (this.blocked(a.address)) throw new ScanError('BLOCKED_TARGET');
      }
    }
    this.pins.set(h, { addrs, expires: Date.now() + this.pinTtl });
    if (this.pins.size > 5000) this.pins.clear();
    return addrs;
  }

  /** Full validation of a URL: shape, port and resolved addresses. */
  async assertUrl(url: URL): Promise<LookupAddress[]> {
    this.assertUrlShape(url);
    return this.resolve(url.hostname);
  }

  /** `lookup` for net/http/https: only ever hands out validated addresses. */
  readonly lookup = (hostname: string, options: LookupOptions | number | LookupCallback, cb?: LookupCallback): void => {
    const callback = (typeof options === 'function' ? options : cb) as LookupCallback;
    const opts: LookupOptions = typeof options === 'object' ? options : {};
    this.resolve(hostname).then(
      (addrs) => {
        const filtered = opts.family ? addrs.filter((a) => a.family === opts.family) : addrs;
        const list = filtered.length ? filtered : addrs;
        if (opts.all) callback(null, list);
        else callback(null, list[0]!.address, list[0]!.family);
      },
      (err: unknown) => {
        const e = new Error(err instanceof Error ? err.message : 'blocked') as NodeJS.ErrnoException;
        e.code = err instanceof ScanError && err.code === 'BLOCKED_TARGET' ? 'EBLOCKED' : 'ENOTFOUND';
        callback(e, '', 0);
      },
    );
  };
}
