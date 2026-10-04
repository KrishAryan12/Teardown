/**
 * Registrable-domain approximation for first/third-party checks. A full Public Suffix List is
 * overkill here; this covers common multi-part suffixes and platform subdomains.
 */
const MULTI = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.nz', 'org.nz', 'co.jp', 'ne.jp', 'or.jp', 'co.kr', 'co.in', 'net.in', 'org.in', 'gov.in', 'ac.in',
  'com.br', 'com.mx', 'com.ar', 'com.cn', 'com.hk', 'com.sg', 'com.tr', 'com.tw', 'co.za', 'co.il',
  'github.io', 'vercel.app', 'netlify.app', 'pages.dev', 'herokuapp.com', 'hf.space', 'web.app',
  'firebaseapp.com', 'azurewebsites.net', 'cloudfront.net', 'onrender.com', 'fly.dev', 'workers.dev',
  'blogspot.com', 'wordpress.com', 'myshopify.com', 'webflow.io', 'squarespace.com', 'wixsite.com',
]);

export function siteOf(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (/^[\d.]+$/.test(h) || h.includes(':')) return h;
  const parts = h.split('.');
  if (parts.length <= 2) return h;
  const last2 = parts.slice(-2).join('.');
  const last3 = parts.slice(-3).join('.');
  if (MULTI.has(last2)) return last3;
  if (MULTI.has(last3)) return parts.slice(-4).join('.');
  return last2;
}

export function sameSite(a: string, b: string): boolean {
  return siteOf(a) === siteOf(b);
}
