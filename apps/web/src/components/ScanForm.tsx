'use client';

import { useEffect, useState } from 'react';
import type { Quota, ScanMode } from '@teardown/core';
import { health, quota as fetchQuota } from '@/lib/api';

type Warm = 'checking' | 'waking' | 'ready' | 'offline';

export function useScanner() {
  const [warm, setWarm] = useState<Warm>('checking');
  const [quota, setQuota] = useState<Quota | null>(null);
  useEffect(() => {
    let alive = true;
    const slow = setTimeout(() => alive && setWarm((w) => (w === 'checking' ? 'waking' : w)), 2500);
    // A sleeping host refuses or stalls connections while it boots: keep pinging for up to 90s.
    const deadline = Date.now() + 90_000;
    const ping = async (): Promise<void> => {
      try {
        await health(Math.max(5000, deadline - Date.now()));
        if (!alive) return;
        setWarm('ready');
        const q = await fetchQuota().catch(() => null);
        if (alive && q) setQuota(q);
      } catch {
        if (!alive) return;
        if (Date.now() < deadline) {
          setWarm('waking');
          await new Promise((r) => setTimeout(r, 3000));
          return ping();
        }
        setWarm('offline');
      }
    };
    // Start after hydration settles so the ping never competes with first render.
    const idle = (cb: () => void) => (typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(cb, { timeout: 1500 }) : setTimeout(cb, 200));
    idle(() => void ping().finally(() => clearTimeout(slow)));
    return () => {
      alive = false;
      clearTimeout(slow);
    };
  }, []);
  return { warm, quota };
}

interface Props {
  onScan: (url: string, mode: ScanMode) => void;
  initialUrl?: string;
  initialMode?: ScanMode;
  busy?: boolean;
}

export function ScanForm({ onScan, initialUrl = '', initialMode = 'single', busy }: Props) {
  const [url, setUrl] = useState(initialUrl);
  const [mode, setMode] = useState<ScanMode>(initialMode);
  const [touched, setTouched] = useState(false);
  const { warm, quota } = useScanner();
  const siteAvailable = !quota || (quota.capacity.site && quota.site.remainingDay > 0);
  const invalid = touched && !/^\s*(https?:\/\/)?[^\s/]+\.[^\s]{2,}/i.test(url);

  useEffect(() => {
    if (!siteAvailable && mode === 'site') setMode('single');
  }, [siteAvailable, mode]);

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (!url.trim() || /^\s*(https?:\/\/)?[^\s/]+\.[^\s]{2,}/i.test(url) === false) return;
        onScan(url.trim(), mode);
      }}
    >
      <div className="slot">
        <div className="slot-cell">
          <label className="label" htmlFor="specimen-url">
            Specimen URL
          </label>
          <input
            id="specimen-url"
            name="url"
            type="text"
            inputMode="url"
            autoComplete="url"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? 'url-error form-notes' : 'form-notes'}
            required
          />
        </div>
        <div className="slot-cell">
        <fieldset className="mode">
          <legend className="label">Mode</legend>
          <label>
            <input type="radio" name="mode" value="single" checked={mode === 'single'} onChange={() => setMode('single')} />
            Single page
          </label>
          <label>
            <input type="radio" name="mode" value="site" checked={mode === 'site'} onChange={() => setMode('site')} disabled={!siteAvailable} />
            Full site
          </label>
        </fieldset>
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Scan this site
        </button>
      </div>
      {invalid && (
        <p id="url-error" className="notice notice-error" role="alert">
          Enter a web address such as example.com or https://example.com/pricing.
        </p>
      )}
      <div className="form-notes" id="form-notes">
        <p>
          {mode === 'site'
            ? `Full site scans up to ${quota?.limits.siteMaxPages ?? 15} pages, takes about 5 minutes, and you get ${quota?.limits.sitePerDay ?? 1} per day.`
            : `Single page takes 30 to 90 seconds. Full site scans up to ${quota?.limits.siteMaxPages ?? 15} pages and takes about 5 minutes (${quota?.limits.sitePerDay ?? 1} per day).`}
        </p>
        <p aria-live="polite">
          {warm === 'checking' && 'Checking the scanner…'}
          {warm === 'waking' && 'Starting the scanner. The free server sleeps when nobody uses it, so waking up can take up to a minute. You can start your scan now; it will wait.'}
          {warm === 'offline' && "The scanner isn't answering right now. You can still try a scan, or look at the sample below."}
          {warm === 'ready' &&
            quota &&
            `${quota.single.remainingHour} single-page scan${quota.single.remainingHour === 1 ? '' : 's'} left this hour · ${quota.site.remainingDay} full-site scan${quota.site.remainingDay === 1 ? '' : 's'} left today${!quota.capacity.site ? " (today's full-site capacity is used up)" : ''}.`}
        </p>
        {quota && !quota.aiAvailable && <p>AI-written advice is unavailable today, so fixes will use Teardown&apos;s built-in instructions.</p>}
        {quota?.perfEngine === 'lighthouse' && <p>Performance is measured with Lighthouse on a small shared server: indicative lab data.</p>}
        {quota?.perfEngine === 'psi' && <p>Performance scores come from Google PageSpeed Insights.</p>}
        {quota?.perfEngine === 'estimated' && <p>Performance is estimated from page weight and requests today (no lab engine available).</p>}
      </div>
    </form>
  );
}
