import type { ReactNode } from 'react';

export const REPO_URL = 'https://github.com/KrishAryan12/Teardown';

/** The drawing frame: hairline border with column letters and row numbers (hidden on phones). */
export function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="frame">
      <div className="frame-cols" aria-hidden="true">
        {['A', 'B', 'C', 'D', 'E', 'F'].map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <div className="frame-rows" aria-hidden="true">
        {['1', '2', '3', '4'].map((r) => (
          <span key={r}>{r}</span>
        ))}
      </div>
      <div className="frame-inner">{children}</div>
    </div>
  );
}

export function SiteHeader() {
  return (
    <header className="site-header">
      <a className="wordmark" href="/">
        Teardown
      </a>
      <nav aria-label="Main">
        <ul>
          <li>
            <a href="/#how-it-works">How it works</a>
          </li>
          <li>
            <a href="/sample">Sample report</a>
          </li>
          <li>
            <a href={REPO_URL}>GitHub</a>
          </li>
        </ul>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div>
        <p>
          Teardown scans public pages only, identifies itself as TeardownBot, and respects robots.txt for full-site scans. Reports aren&apos;t stored: they live in your browser
          until you close the page. <a href="/privacy">Privacy and AI use</a>.
        </p>
      </div>
      <div>
        <p>
          Free and open source. <a href={REPO_URL}>Source on GitHub</a>.
        </p>
      </div>
    </footer>
  );
}
