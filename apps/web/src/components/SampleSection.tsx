'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import type { Report } from '@teardown/core';

const SampleTeaser = dynamic(() => import('./report/SampleTeaser'), { ssr: false });

/** Loads the pre-baked sample (and its JS) only when the section approaches the viewport. */
export function SampleSection() {
  const ref = useRef<HTMLDivElement>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        fetch('/sample/report.json')
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
          .then((r: Report) => setReport(r))
          .catch(() => setFailed(true));
      },
      { rootMargin: '0px 0px 100px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ minHeight: 480 }}>
      {report ? <SampleTeaser report={report} /> : <p className="dim">{failed ? 'The sample could not be loaded.' : 'Loading the sample teardown…'}</p>}
    </div>
  );
}
