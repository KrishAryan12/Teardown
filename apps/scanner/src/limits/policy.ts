import type { Quota, ScanMode } from '@teardown/core';
import type { Config } from '../config';
import { ScanError } from '../errors';
import { DAY, HOUR, type RateStore } from './rateStore';

/**
 * Scan admission: per-IP (single: hourly + daily; site: daily), per target domain (daily, global),
 * and global daily capacity per mode. Checks everything first, then increments, so a refused
 * request never consumes allowance.
 */
export class LimitPolicy {
  constructor(
    private readonly cfg: Config,
    private readonly store: RateStore,
  ) {}

  private ipKey(ip: string) {
    return `ip:${ip}`;
  }

  async quota(ip: string, aiAvailable: boolean, perfEngine: Quota['perfEngine']): Promise<Quota> {
    const c = this.cfg;
    const [h, d, s, gs, gsite] = await Promise.all([
      this.store.get(`${this.ipKey(ip)}:single`, HOUR),
      this.store.get(`${this.ipKey(ip)}:single`, DAY),
      this.store.get(`${this.ipKey(ip)}:site`, DAY),
      this.store.get('global:single', DAY),
      this.store.get('global:site', DAY),
    ]);
    const singleCap = gs.count < c.GLOBAL_SINGLE_PER_DAY;
    const siteCap = c.GLOBAL_SITE_PER_DAY > 0 && gsite.count < c.GLOBAL_SITE_PER_DAY;
    const singleHourLeft = Math.max(0, c.SINGLE_PER_HOUR - h.count);
    const singleDayLeft = Math.max(0, c.SINGLE_PER_DAY - d.count);
    return {
      single: {
        remainingHour: singleHourLeft,
        remainingDay: singleDayLeft,
        resetAt: new Date(singleDayLeft === 0 ? d.resetAt : h.resetAt).toISOString(),
      },
      site: { remainingDay: Math.max(0, c.SITE_PER_DAY - s.count), resetAt: new Date(s.resetAt).toISOString(), capacityAvailable: siteCap },
      capacity: { single: singleCap, site: siteCap },
      aiAvailable,
      perfEngine,
      limits: {
        singlePerHour: c.SINGLE_PER_HOUR,
        singlePerDay: c.SINGLE_PER_DAY,
        sitePerDay: c.SITE_PER_DAY,
        siteMaxPages: c.SITE_MAX_PAGES,
        pdfPerHour: c.PDF_PER_HOUR,
      },
    };
  }

  /** Throws RATE_LIMITED / CAPACITY, or records the scan and returns rate-limit header values. */
  async admit(ip: string, host: string, mode: ScanMode): Promise<{ limit: number; remaining: number; resetAt: number }> {
    const c = this.cfg;
    const ipk = this.ipKey(ip);
    const domain = `domain:${host.toLowerCase()}`;
    if (mode === 'site') {
      const [mine, global] = await Promise.all([this.store.get(`${ipk}:site`, DAY), this.store.get('global:site', DAY)]);
      if (c.GLOBAL_SITE_PER_DAY === 0 || global.count >= c.GLOBAL_SITE_PER_DAY) {
        throw new ScanError('CAPACITY', "Today's full-site scans are used up. Try a single-page scan instead, or come back tomorrow.", { suggestMode: 'single', resetAt: new Date(global.resetAt).toISOString() });
      }
      if (mine.count >= c.SITE_PER_DAY) {
        throw new ScanError('RATE_LIMITED', `You can run ${c.SITE_PER_DAY} full-site scan${c.SITE_PER_DAY === 1 ? '' : 's'} per day. Single-page scans are still available.`, {
          resetAt: new Date(mine.resetAt).toISOString(),
          suggestMode: 'single',
        });
      }
    } else {
      const [hour, day, global] = await Promise.all([this.store.get(`${ipk}:single`, HOUR), this.store.get(`${ipk}:single`, DAY), this.store.get('global:single', DAY)]);
      if (global.count >= c.GLOBAL_SINGLE_PER_DAY) throw new ScanError('CAPACITY', "Today's scanning capacity is used up. Please come back tomorrow.", { resetAt: new Date(global.resetAt).toISOString() });
      if (day.count >= c.SINGLE_PER_DAY) throw new ScanError('RATE_LIMITED', `You've used today's ${c.SINGLE_PER_DAY} scans.`, { resetAt: new Date(day.resetAt).toISOString() });
      if (hour.count >= c.SINGLE_PER_HOUR) throw new ScanError('RATE_LIMITED', `You've used this hour's ${c.SINGLE_PER_HOUR} scans.`, { resetAt: new Date(hour.resetAt).toISOString() });
    }
    const dom = await this.store.get(domain, DAY);
    if (dom.count >= c.DOMAIN_PER_DAY) {
      throw new ScanError('RATE_LIMITED', `${host} has been scanned ${c.DOMAIN_PER_DAY} times today, the daily limit per site.`, { resetAt: new Date(dom.resetAt).toISOString() });
    }

    await this.store.incr(domain, DAY);
    if (mode === 'site') {
      await this.store.incr('global:site', DAY);
      const r = await this.store.incr(`${ipk}:site`, DAY);
      return { limit: c.SITE_PER_DAY, remaining: Math.max(0, c.SITE_PER_DAY - r.count), resetAt: r.resetAt };
    }
    await this.store.incr('global:single', DAY);
    await this.store.incr(`${ipk}:single`, DAY);
    const r = await this.store.incr(`${ipk}:single`, HOUR);
    return { limit: c.SINGLE_PER_HOUR, remaining: Math.max(0, c.SINGLE_PER_HOUR - r.count), resetAt: r.resetAt };
  }

  /** PDF exports: separate per-IP hourly limit. */
  async admitPdf(ip: string): Promise<void> {
    const k = `${this.ipKey(ip)}:pdf`;
    const cur = await this.store.get(k, HOUR);
    if (cur.count >= this.cfg.PDF_PER_HOUR) {
      throw new ScanError('RATE_LIMITED', `You can make ${this.cfg.PDF_PER_HOUR} PDF exports per hour.`, { resetAt: new Date(cur.resetAt).toISOString() });
    }
    await this.store.incr(k, HOUR);
  }
}
