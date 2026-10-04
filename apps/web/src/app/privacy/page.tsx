import type { Metadata } from 'next';
import { Frame, SiteFooter, SiteHeader } from '@/components/Chrome';

export const metadata: Metadata = {
  title: 'Privacy and AI use',
  description: 'What Teardown stores (nothing), what it logs, and which third parties process scan data.',
  alternates: { canonical: '/privacy/' },
};

export default function Privacy() {
  return (
    <Frame>
      <SiteHeader />
      <main id="main" tabIndex={-1} style={{ maxWidth: '72ch', paddingBottom: 32 }}>
        <h1 style={{ fontSize: 'clamp(2rem, 6vw, 3.5rem)', textTransform: 'uppercase', margin: '24px 0 24px' }}>Privacy and AI use</h1>
        <h2 style={{ fontSize: '1.75rem', margin: '32px 0 12px' }}>What Teardown keeps</h2>
        <p>Nothing about you. There are no accounts, cookies or analytics. Reports are built on the scanner, sent to your browser, and kept only in this tab. Close or refresh it and the report is gone, unless you downloaded an export.</p>
        <p>
          The scanner keeps a short-lived copy of each report in memory (up to 6 hours) so a repeat scan of the same page is instant. It is lost whenever the scanner restarts.
        </p>
        <h2 style={{ fontSize: '1.75rem', margin: '32px 0 12px' }}>What the scanner logs</h2>
        <p>The scanned hostname, scan mode, outcome, duration and error code. Not full URLs, not page content and not your IP address. Your IP is held in memory only to enforce scan limits, and forgotten within a day.</p>
        <h2 style={{ fontSize: '1.75rem', margin: '32px 0 12px' }}>AI providers</h2>
        <p>
          To order the fixes and write the summary, Teardown sends a short list of findings to a free-tier AI model from one of these providers: Google AI Studio (Gemini), Groq,
          Hugging Face Inference Providers, or OpenRouter. The list contains rule ids, CSS selectors and short snippets from the public page you scanned. It never contains your
          details, and never the full page HTML.
        </p>
        <p>Free tiers may use submitted content to improve the provider&apos;s products. If that matters for the site you are scanning, don&apos;t scan it. AI text is labelled in every report, and the report is complete without it.</p>
        <h2 style={{ fontSize: '1.75rem', margin: '32px 0 12px' }}>Being scanned</h2>
        <p>
          Teardown identifies itself as <code className="mono">TeardownBot</code>, scans public pages only, follows robots.txt for full-site scans, and never tries to get past
          logins, paywalls or bot protection.
        </p>
      </main>
      <SiteFooter />
    </Frame>
  );
}
