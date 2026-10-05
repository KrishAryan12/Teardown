import type { Metadata, Viewport } from 'next';
import { Big_Shoulders, Martian_Mono, Public_Sans } from 'next/font/google';
import './globals.css';

// Fonts are downloaded at build time and self-hosted with the static export.
// No metric-matched fallback exists for Big Shoulders, so 'optional' avoids a late swap (layout shift).
const shoulders = Big_Shoulders({ subsets: ['latin'], weight: ['700', '800'], variable: '--font-shoulders', display: 'optional', adjustFontFallback: false, fallback: ['Arial Narrow', 'sans-serif'] });
// 'optional' keeps first paint final (no late repaint of the LCP text); fallback metrics are size-adjusted.
const publicSans = Public_Sans({ subsets: ['latin'], weight: ['400', '600', '700'], variable: '--font-public', display: 'optional' });
// Mono is never in the first paint, so it isn't preloaded.
const martian = Martian_Mono({ subsets: ['latin'], weight: ['400', '700'], variable: '--font-martian', display: 'swap', preload: false });

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://teardown-lab.vercel.app';
const DESCRIPTION =
  'Paste a URL and Teardown takes the site apart in a real browser: performance, SEO, accessibility and UX checks, its brand system, and a prioritised fix list you can hand to an AI coding agent.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: 'Teardown: take any website apart', template: '%s · Teardown' },
  description: DESCRIPTION,
  applicationName: 'Teardown',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: 'Teardown',
    title: 'Teardown: take any website apart',
    description: DESCRIPTION,
    url: '/',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Teardown: an annotated website specimen with numbered fix pins' }],
  },
  twitter: { card: 'summary_large_image', title: 'Teardown: take any website apart', description: DESCRIPTION, images: ['/og.png'] },
  icons: { icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }] },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#0D2B4B',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${shoulders.variable} ${publicSans.variable} ${martian.variable}`}>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
