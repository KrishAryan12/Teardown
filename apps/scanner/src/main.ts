import { loadConfig, VERSION } from './config';
import { createServices } from './services';
import { buildServer } from './server';
import { log } from './util/log';

const cfg = loadConfig();
const services = createServices(cfg);
const { app, manager } = await buildServer(services);

await app.listen({ port: cfg.PORT, host: cfg.HOST });
log.info({
  event: 'listening',
  port: cfg.PORT,
  version: VERSION,
  env: cfg.NODE_ENV,
  ai: services.ai.available(),
  perf: services.perf.active(),
  privateTargets: cfg.ALLOW_PRIVATE_TARGETS,
});

// Warm the browser in the background so the first scan after a wake-up is faster.
void services.pool.getBrowser().catch((e) => log.warn({ event: 'browser_warmup_failed', error: e instanceof Error ? e.message.split('\n')[0] : 'unknown' }));

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ event: 'shutdown', signal, ...manager.stats() });
  // Finish (or abort) running scans, then close HTTP and the browser.
  await manager.drain(20_000);
  await app.close().catch(() => undefined);
  await services.close().catch(() => undefined);
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (e) => log.error({ event: 'unhandled_rejection', error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200) }));
