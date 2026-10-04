// Starts the production build (`next start`) on a port and waits until /api/health answers.
// Used by the a11y check and the demo recorder. Run `next build` first.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WEB_DIR = fileURLToPath(new URL('..', import.meta.url));

export async function serve(port = 3000) {
  const nextBin = fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url));
  const child = spawn(process.execPath, [nextBin, 'start', '-p', String(port), '-H', '127.0.0.1'], {
    cwd: WEB_DIR,
    env: { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`next start exited early:\n${output}`);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) {
      child.kill();
      throw new Error(`next start did not become ready on port ${port}:\n${output}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return {
    close() {
      child.kill();
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT ?? 3000);
  await serve(port);
  console.log(`serving the production build on http://127.0.0.1:${port}`);
}
