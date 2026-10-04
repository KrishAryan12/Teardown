import { Frame, SiteFooter, SiteHeader } from '@/components/Chrome';
import { ScanApp } from '@/components/ScanApp';
import { SampleSection } from '@/components/SampleSection';

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: 'Teardown',
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Any (web)',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  description: 'Free website teardown: performance, SEO, accessibility, UX and brand extraction with a prioritised, agent-ready fix list.',
};

function Hero() {
  return (
    <>
      <h1 id="hero-title">Take any website apart</h1>
      <p className="lead">
        Paste a URL. Teardown scans it in a real browser and hands back a prioritised fix list, the site&apos;s brand system, and a brief your AI coding agent can work
        through task by task.
      </p>
    </>
  );
}

function Landing() {
  return (
    <>
      <section className="section" aria-labelledby="sample-title">
        <div className="section-head">
          <h2 id="sample-title">Sheet 00 · Sample teardown</h2>
          <span className="label">A real scan of a demo shop, no quota spent</span>
        </div>
        <SampleSection />
      </section>

      <section className="section deferred" aria-labelledby="get-title">
        <div className="section-head">
          <h2 id="get-title">What you get</h2>
        </div>
        <div className="exports-grid">
          <div>
            <span className="label">01 · For people</span>
            <h3>PDF report</h3>
            <p>A drawing set of your site: scores, an annotated screenshot, the brand sheet and every fix with how to check it&apos;s done.</p>
          </div>
          <div>
            <span className="label">02 · For AI coding agents</span>
            <h3>Agent brief</h3>
            <p>A Markdown brief with tasks in priority order, acceptance criteria and your brand tokens. Paste it into Claude Code, Cursor or Copilot and let it work.</p>
          </div>
          <div>
            <span className="label">03 · For machines</span>
            <h3>JSON</h3>
            <p>Every finding, score and design token in a versioned format, ready for your own tooling or a before-and-after comparison.</p>
          </div>
        </div>
      </section>

      <section className="section deferred" id="how-it-works" aria-labelledby="how-title">
        <div className="section-head">
          <h2 id="how-title">How it works</h2>
        </div>
        <ol className="steps-list">
          <li>
            <strong>Real browser.</strong> Chromium loads the page at desktop and phone sizes, scrolls it, and reads the styles it actually rendered, not just the HTML.
          </li>
          <li>
            <strong>Rules, not guesses.</strong> Over 60 checks for SEO, accessibility (with axe-core), UX, security and brand consistency, plus a Lighthouse performance run.
          </li>
          <li>
            <strong>Ordered for you.</strong> A small AI model ranks the problems and writes the top instructions. It can&apos;t add, remove or re-grade findings; if it&apos;s
            unavailable, the built-in fixes are used.
          </li>
        </ol>
      </section>
    </>
  );
}

export default function Home() {
  return (
    <Frame>
      <SiteHeader />
      <main id="main" tabIndex={-1}>
        <ScanApp hero={<Hero />} landing={<Landing />} />
      </main>
      <SiteFooter />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </Frame>
  );
}
