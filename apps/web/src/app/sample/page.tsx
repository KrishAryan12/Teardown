import type { Metadata } from 'next';
import { Frame, SiteFooter, SiteHeader } from '@/components/Chrome';
import { SampleReport } from './SampleReport';

export const metadata: Metadata = {
  title: 'Sample report',
  description: 'A full Teardown report for a demo ceramics shop: annotated specimen, prioritised fixes, brand sheet and exports.',
  alternates: { canonical: '/sample' },
};

export default function SamplePage() {
  return (
    <Frame>
      <SiteHeader />
      <main id="main" tabIndex={-1}>
        <h1 style={{ fontSize: 'clamp(2rem, 6vw, 3.5rem)', textTransform: 'uppercase', margin: '24px 0 8px' }}>Sample report</h1>
        <p className="dim">A real scan of a demo ceramics shop, generated from a test page with the same pipeline as live scans.</p>
        <SampleReport />
      </main>
      <SiteFooter />
    </Frame>
  );
}
