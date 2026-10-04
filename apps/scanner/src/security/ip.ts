import ipaddr from 'ipaddr.js';

/**
 * Explicit deny-list, checked in addition to ipaddr.js range names.
 * Anything that is not plain public unicast is refused.
 */
const DENY_V4: [string, number][] = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // RFC1918
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, cloud metadata (169.254.169.254)
  ['172.16.0.0', 12], // RFC1918
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16], // RFC1918
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
];

const DENY_V6: [string, number][] = [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['::', 96], // IPv4-compatible (deprecated)
  ['::ffff:0:0', 96], // IPv4-mapped
  ['64:ff9b::', 96], // NAT64
  ['64:ff9b:1::', 48], // local-use NAT64
  ['100::', 64], // discard
  ['2001::', 23], // IETF protocol assignments (Teredo, benchmarking, ORCHID...)
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (deprecated)
  ['ff00::', 8], // multicast
];

const parsedV4 = DENY_V4.map(([a, p]) => [ipaddr.IPv4.parse(a), p] as const);
const parsedV6 = DENY_V6.map(([a, p]) => [ipaddr.IPv6.parse(a), p] as const);

/** Strips brackets from IPv6 literals and zone ids. */
function clean(addr: string): string {
  return addr.replace(/^\[|\]$/g, '').replace(/%.*$/, '');
}

export function isIpLiteral(host: string): boolean {
  return ipaddr.isValid(clean(host));
}

/** Returns a reason string when the address must not be contacted, otherwise null. */
export function blockedReason(address: string): string | null {
  const raw = clean(address);
  if (!ipaddr.isValid(raw)) return 'not an IP address';
  const ip = ipaddr.parse(raw);
  if (ip.kind() === 'ipv6') {
    const v6 = ip as ipaddr.IPv6;
    // Check the embedded IPv4 too, so ::ffff:127.0.0.1 is reported as loopback.
    if (v6.isIPv4MappedAddress()) {
      const inner = blockedReason(v6.toIPv4Address().toString());
      return `ipv4-mapped${inner ? ` (${inner})` : ''}`;
    }
    for (const [net, prefix] of parsedV6) if (v6.match(net, prefix)) return `${v6.range()} ${net.toString()}/${prefix}`;
    if (v6.range() !== 'unicast') return v6.range();
    return null;
  }
  const v4 = ip as ipaddr.IPv4;
  for (const [net, prefix] of parsedV4) if (v4.match(net, prefix)) return `${v4.range()} ${net.toString()}/${prefix}`;
  if (v4.range() !== 'unicast') return v4.range();
  return null;
}

export function isBlockedIp(address: string): boolean {
  return blockedReason(address) !== null;
}
