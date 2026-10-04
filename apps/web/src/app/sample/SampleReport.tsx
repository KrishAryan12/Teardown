'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import type { Report } from '@teardown/core';

const ReportSheet = dynamic(() => import('@/components/report/ReportSheet'), { ssr: false, loading: () => <p className="dim">Laying out the sheet…</p> });

export function SampleReport() {
  const [report, setReport] = useState<Report | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch('/sample/report.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setReport)
      .catch(() => setFailed(true));
  }, []);
  if (failed) return <p className="notice notice-error">The sample report could not be loaded. Reload the page to try again.</p>;
  if (!report) return <p className="dim">Loading the sample report…</p>;
  return <ReportSheet report={report} headingLevel="h2" />;
}
