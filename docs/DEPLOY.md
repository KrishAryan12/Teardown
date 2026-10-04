# Deploying Teardown

Two pieces: the **scanner** (a Docker container) and the **website** (static files). Both run on free tiers. Variable names below match `.env.example` exactly.

## 1. Scanner on a HuggingFace Space (Docker SDK)

> **Check first:** HuggingFace's Spaces docs (checked 2026-10-04) say Docker Spaces need a PRO plan to *create*. If you can't create one on a free account, use the Render fallback in section 4; nothing else changes.

1. Create a Space at <https://huggingface.co/new-space>: SDK **Docker** (Blank template), hardware **CPU basic**, visibility **Public** (browsers call it directly). Name it e.g. `teardown-scanner`. Its URL will be `https://<user>-teardown-scanner.hf.space`.
2. Create a **write** token (fine-grained, write access to this Space only) at <https://huggingface.co/settings/tokens>.
3. In the GitHub repo, **Settings → Secrets and variables → Actions**:
   - secret `HF_DEPLOY_TOKEN` = the write token;
   - variable `HF_SPACE` = `<user>/teardown-scanner`.
4. In the Space, **Settings → Variables and secrets**, add **secrets**:

   | Name | Value | Required |
   |---|---|---|
   | `ALLOWED_ORIGINS` | Your website URL(s), comma-separated, exact, no trailing slash | Yes |
   | `GEMINI_API_KEY` | Google AI Studio key | Recommended |
   | `GROQ_API_KEY` | Groq key | Recommended |
   | `HF_TOKEN` | Fine-grained token with "Make calls to Inference Providers" | Optional |
   | `OPENROUTER_API_KEY` | OpenRouter key (only `:free` models are used) | Optional |
   | `PSI_API_KEY` | PageSpeed Insights key | Optional |
   | `TURNSTILE_SECRET` | Cloudflare Turnstile secret | Optional |

   Any other setting in `.env.example` (limits, models, `CONTACT_URL`) can be added as a plain **variable**.
5. Push to `main` (or run the **Deploy scanner** workflow by hand). The workflow runs `scripts/build-space.sh`, force-pushes the flattened folder to the Space and waits for `/health`.
6. Check it: `pnpm health https://<user>-teardown-scanner.hf.space`.

What the Space build does: `Dockerfile` (from `apps/scanner/Dockerfile`) starts from the official `mcr.microsoft.com/playwright:v1.63.0-noble` image (Chromium and fonts preinstalled), installs the scanner's dependencies with pnpm, bundles it with esbuild and runs `node apps/scanner/dist/main.js` as UID 1000 on port 7860. Secrets are runtime environment variables and never part of the image. Free Spaces sleep when idle; the website shows "Starting the scanner" while one wakes.

Outbound traffic from a Space is limited to ports 80, 443 and 8080. Teardown only ever scans ports 80 and 443 anyway.

## 2. Website on Vercel (or any static host)

1. Import the GitHub repo in Vercel. **Root Directory**: `apps/web`. Allow files outside the root directory (the app imports `packages/core`).
2. Environment variables:
   - `NEXT_PUBLIC_SCANNER_URL` = your Space URL, e.g. `https://<user>-teardown-scanner.hf.space`;
   - `NEXT_PUBLIC_SITE_URL` = the site's own URL (canonical and Open Graph links).
3. Deploy. Vercel detects Next.js and serves the static export from `out/`.
4. Copy the site URL into the Space's `ALLOWED_ORIGINS` secret and restart the Space.

The app uses no Vercel-specific APIs. To move hosts, run `pnpm --filter @teardown/web build` and upload `apps/web/out/` to Cloudflare Pages, Netlify or GitHub Pages.

> **Vercel Hobby terms** (checked 2026-10-04): Hobby is for non-commercial personal use, and "commercial" includes a consultant earning from the site. A lead-generation tool for freelance work may count. Cloudflare Pages and Netlify have free tiers without that clause.

Update `apps/web/public/robots.txt` and `sitemap.xml` with your real domain.

## 3. Smoke test (manual)

After both are live:

1. `pnpm health https://<user>-teardown-scanner.hf.space`: health, quota, and three refused private targets.
2. Open the site: the landing page loads, the sample teardown plays once, "N scans left this hour" appears.
3. Scan a site you own (single page): the bench log streams steps; the sheet shows pins, the brand sheet and fixes; the performance readout names its source.
4. Download the PDF, Markdown brief and JSON. Paste the brief into an AI coding agent and confirm it can work through T1.
5. Run a full-site scan of a small site: pages stream in the log, the report says how many pages were scanned.
6. Try `http://localhost`, `http://127.0.0.1` and `http://192.168.1.1`: each is refused with a plain message.
7. Scan until the hourly limit: the message shows when you can scan again.

## 4. Fallback host: Render (free web service, Docker)

If a Docker Space isn't available, the same container runs on Render's free web service:

1. Run `scripts/build-space.sh` and push `.space-build/` to its own GitHub repo, or point Render at this repo with **Dockerfile path** `apps/scanner/Dockerfile` and a pre-build command that runs the script.
2. Free instances have about 512 MB of RAM, which is tight for Chromium plus Lighthouse. Set `MAX_CONCURRENT_SCANS=1`, `SITE_CONCURRENCY=1`, and `PERF_ENGINE=psi` (with a key) or `PERF_ENGINE=estimate`.
3. Render sets `PORT` itself; the scanner reads it. Set `TRUST_PROXY_HOPS=1`.

## 5. AI defaults

Run `pnpm ai:eval` locally with your keys in `.env`. It reports JSON validity, invalid-id rate, length violations and median latency per model. Put the best model first in each `*_MODELS` variable and record the results in `docs/DECISIONS.md`.
