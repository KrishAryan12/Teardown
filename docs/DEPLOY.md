# Deploying Teardown

Teardown deploys as **one Vercel project**: the website is pre-rendered, and the scanner runs as Vercel Functions under `/api`. Nothing here needs a card. A Docker image is also provided for anyone who prefers a long-running server (section 5).

| Piece | Where | Free tier |
|---|---|---|
| Website + scanner API | Vercel (Hobby) | 2 GB / 1 vCPU functions, 300 s per call |
| Rate limits and daily budgets | Upstash Redis | Free database, GitHub login |
| Performance scores | Google PageSpeed Insights API | 25,000 calls/day, no billing account |
| AI-written advice | Gemini (AI Studio), Groq, optional HF / OpenRouter | Free tiers |

## 1. Get the keys

| Variable | Where to get it | Required |
|---|---|---|
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | <https://console.upstash.com> → Redis → Create database (Free, region **us-east-1**) → REST API | Strongly recommended (without it, limits are per function instance) |
| `PSI_API_KEY` | <https://console.cloud.google.com> → new project → enable **PageSpeed Insights API** → Credentials → API key (restrict it to that API). No billing account needed. | Recommended (without it, performance is an estimate) |
| `GEMINI_API_KEY` | <https://aistudio.google.com> → Get API key | Recommended |
| `GROQ_API_KEY` | <https://console.groq.com> → API Keys | Recommended |
| `HF_TOKEN` | <https://huggingface.co/settings/tokens> (fine-grained, "Make calls to Inference Providers") | Optional |
| `OPENROUTER_API_KEY` | <https://openrouter.ai> → Keys (only `:free` models are used) | Optional |
| `TURNSTILE_SECRET` | Cloudflare Turnstile | Optional |

With no AI key at all, every report still has complete fixes from the built-in templates.

## 2. Create the Vercel project

1. <https://vercel.com/signup> → Continue with GitHub (Hobby).
2. **Add New → Project** → import the repository.
3. **Root Directory:** `apps/web`. Keep "Include files outside the root directory" on (the app imports `apps/scanner` and `packages/core`). Framework, build and install commands: defaults.
4. **Environment Variables:** add the keys from section 1, plus `CONTACT_URL` (shown in the TeardownBot user agent). Leave `NEXT_PUBLIC_SCANNER_URL` unset: the site calls its own `/api`.
5. **Deploy.**
6. Settings → Functions: keep the region at **Washington, D.C. (iad1)** so it sits next to Upstash us-east-1.
7. Optional: Settings → Domains for a custom domain. Update `apps/web/public/robots.txt` and `sitemap.xml` with the final domain, and set `NEXT_PUBLIC_SITE_URL`.

Vercel builds on every push to `main`; pull requests get preview deployments.

### What runs where

| Route | Runtime | Limits |
|---|---|---|
| `/`, `/sample`, `/privacy` | Static (CDN) | — |
| `GET /api/health`, `GET /api/quota` | Function | — |
| `POST /api/scan/stream` | Function, `maxDuration = 300` | One scan per call; the scanner stops itself at 270 s (`SCAN_DEADLINE_MS`) |
| `POST /api/export/pdf` | Function, `maxDuration = 60` | Report body ≤ 4 MB |

On Vercel (detected via the `VERCEL` variable) the scanner applies serverless defaults, each overridable by setting the variable: `SITE_MAX_PAGES=5`, `SITE_CONCURRENCY=1`, `SITE_BUDGET_MS=150000`, `PERF_MAX_PAGES_FULL=0`, `MAX_CONCURRENT_SCANS=3`, `REPORT_MAX_BYTES=4000000`, `AI_TIMEOUT_MS=20000`, `AI_TOTAL_BUDGET_MS=45000`, `SCAN_DEADLINE_MS=270000`, `LIGHTHOUSE_ENABLED=false`.

Chromium comes from `@sparticuz/chromium` (x64 Linux, unpacked to `/tmp` on cold start). Lighthouse isn't shipped in the function; performance comes from PageSpeed Insights, or the documented estimate if there's no key.

### Free-tier budget

Vercel Hobby includes about 4 hours of active CPU a month. A single-page scan uses roughly 15–40 s of CPU (performance runs on Google's side via PSI), so expect a few hundred scans a month. The per-IP and global daily limits (`SINGLE_PER_DAY`, `GLOBAL_SINGLE_PER_DAY`, …) keep usage inside that; lower `GLOBAL_SINGLE_PER_DAY` if you get close.

> **Vercel Hobby terms** (checked 2026-10-04): Hobby is for non-commercial personal use, and "commercial" includes a consultant earning from the site. A portfolio demo is fine; a lead-generation tool may not be.

## 3. Smoke test

After the first deploy (replace the URL):

1. `pnpm health https://your-app.vercel.app`: health, quota, and three refused private targets.
2. Open the site: the landing page loads, the sample teardown plays once, and the form shows "N scans left this hour" and the performance engine.
3. Scan a site you own: the bench log streams steps; the sheet shows pins, the brand sheet and fixes; the performance readout says "PageSpeed Insights" (or "Estimate" without a key).
4. Download the PDF, Markdown brief and JSON.
5. Run a full-site scan of a small site: pages stream in, capped at 5.
6. Try `http://localhost`, `http://127.0.0.1` and `http://192.168.1.1`: each is refused.
7. Scan until the hourly limit: the message shows when you can scan again.

## 4. Local development

```bash
pnpm install
pnpm --filter @teardown/scanner exec playwright install chromium
cp .env.example .env
pnpm --filter @teardown/web dev        # site + API on http://localhost:3000
```

The dev server uses Playwright's Chromium (not the serverless build) and in-memory limits unless the Upstash variables are set.

## 5. Alternative: the Docker scanner

The scanner also runs as a long-lived Fastify server in Docker, with a queue, SSE replay, local Lighthouse and the full 15-page site mode. Use it on any container host or VM:

```bash
bash scripts/build-space.sh .space-build    # flattened build context
docker build -t teardown-scanner .space-build
docker run -p 7860:7860 -e ALLOWED_ORIGINS=https://your-site.example -e GEMINI_API_KEY=... teardown-scanner
```

Then build the website with `NEXT_PUBLIC_SCANNER_URL=https://your-scanner.example`; it speaks the same `POST /api/scan/stream` protocol to either backend. The image is based on `mcr.microsoft.com/playwright:v1.63.0-noble`, runs as UID 1000 on port 7860 (HuggingFace Docker Spaces compatible; `.github/workflows/deploy-scanner.yml` deploys there when `HF_SPACE` is set), and needs about 2 GB of RAM for comfortable Lighthouse runs.
