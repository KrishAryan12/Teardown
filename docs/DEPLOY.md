# Deploying Teardown on Vercel

Teardown deploys as **one Vercel project**. The website is pre-rendered to the CDN, and the scanner runs as Vercel Functions under `/api`. None of the services below asks for a card.

| Piece | Service | Free tier |
|---|---|---|
| Website and scanner functions | Vercel Hobby | Functions with 2 GB / 1 vCPU, up to 300 s per call (Fluid Compute) |
| Rate limits, daily budgets, scan gate | Upstash Redis | Free database |
| Performance scores | Google PageSpeed Insights API | 25,000 calls a day, no billing account |
| AI-written advice | Gemini (AI Studio), Groq, optional Hugging Face / OpenRouter | Free tiers |

The deploy takes about 20 minutes:

| Step | What you do | Done when |
|---|---|---|
| [1](#step-1-collect-the-keys) | Collect the keys | You have the values in a password manager |
| [2](#step-2-create-the-vercel-project) | Create the Vercel project | The first build is green |
| [3](#step-3-configure-the-scan-function) | Configure the scan function | `/api/scan/stream` shows 300 s and iad1 |
| [4](#step-4-validate-the-deployment) | Validate the deployment | `pnpm health … --scan …` passes |
| [5](#step-5-finish-up) | Finish up | Domain, sitemap and site URL set |

---

## Step 1: Collect the keys

Every key is optional. Each one switches on a better path, and a deployment with no keys still produces complete reports.

| Variable | Where to get it | Without it |
|---|---|---|
| `UPSTASH_REDIS_REST_URL`<br>`UPSTASH_REDIS_REST_TOKEN` | <https://console.upstash.com>: **Create database**, type Redis, plan **Free**, region **us-east-1 (N. Virginia)**. Copy both values from the **REST API** section. | Limits and budgets are tracked per function instance, so they reset on every cold start. **Strongly recommended.** |
| `PSI_API_KEY` | <https://console.cloud.google.com>: create a project, open **APIs & Services → Library**, enable **PageSpeed Insights API**, then **Credentials → Create credentials → API key**. Restrict the key to that one API. No billing account is needed. | Performance is a labelled estimate |
| `GEMINI_API_KEY` | <https://aistudio.google.com>: **Get API key** | The next provider is tried |
| `GROQ_API_KEY` | <https://console.groq.com>: **API Keys** | The next provider is tried |
| `HF_TOKEN` | <https://huggingface.co/settings/tokens>: a fine-grained token with "Make calls to Inference Providers" | — |
| `OPENROUTER_API_KEY` | <https://openrouter.ai>: **Keys** (only `:free` models are used) | — |
| `TURNSTILE_SECRET` | Cloudflare Turnstile | No bot challenge |

If no AI provider answers, the report uses the built-in order and fix templates and says so.

> **Upstash from the Vercel Marketplace** works too: **Storage → Upstash for Redis**. It injects `KV_REST_API_URL` and `KV_REST_API_TOKEN`, which the scanner also reads, so you can skip adding the Upstash variables by hand.

## Step 2: Create the Vercel project

1. Sign up at <https://vercel.com/signup> with **Continue with GitHub** and choose the **Hobby** plan.
2. Choose **Add New → Project** and import the repository. If you've forked it, import your fork.
3. On the configure screen:

   | Setting | Value |
   |---|---|
   | Framework Preset | Next.js (detected) |
   | **Root Directory** | Leave it at the repository root (`./`). The root `vercel.json` defines one service, `web`, rooted at `apps/web` |
   | Build / Output / Install commands | Leave the defaults |

4. Open **Environment Variables** and add these for **Production** and **Preview**:

   | Variable | Value |
   |---|---|
   | The keys from step 1 | Your values |
   | `CONTACT_URL` | A page where site owners can reach you (it appears in the `TeardownBot` user agent), e.g. your repo URL |
   | `ENABLE_EXPERIMENTAL_COREPACK` | `1`, so Vercel uses the pnpm version pinned in `package.json` (`packageManager`) |

   Leave `NEXT_PUBLIC_SCANNER_URL` **unset**, because the site calls its own `/api`. You'll set `NEXT_PUBLIC_SITE_URL` in step 5.

5. Click **Deploy**. The build log should end with this route table. `ƒ` means the route is a function:

   ```
   ┌ ○ /
   ├ ƒ /api/export/pdf
   ├ ƒ /api/health
   ├ ƒ /api/quota
   ├ ƒ /api/scan/stream
   ├ ○ /privacy
   └ ○ /sample
   ```

From now on, every push to `main` deploys to production and every pull request gets a preview URL.

<details>
<summary><b>Prefer the CLI?</b></summary>

```bash
npm i -g vercel
vercel login
vercel link                 # from the repo root; pick or create the project
# Root Directory stays at the repo root; vercel.json points the web service at apps/web
vercel env add UPSTASH_REDIS_REST_URL production     # repeat for each variable
vercel deploy --prod
```

</details>

## Step 3: Configure the scan function

One scan runs inside one function call. `POST /api/scan/stream` admits the request, launches serverless Chromium, scans the page and streams progress events back, all in a single response. The settings below decide whether that call is allowed to run long enough.

### 3.1 Check the project settings

| Where (Project → Settings) | Setting | Why |
|---|---|---|
| **Functions → Fluid Compute** | **Enabled** (the default for new projects) | Without it, Hobby functions stop at 60 s and longer scans fail with `FUNCTION_INVOCATION_TIMEOUT` |
| **Functions → Function Region** | **Washington, D.C., USA (iad1)** (the default) | Keeps the functions next to Upstash us-east-1 |
| **Build and Deployment → Root Directory** | The repository root (empty or `./`) | The root `vercel.json` uses Vercel Services: one service, `web` (`apps/web`, Next.js), receives every request through a catch-all rewrite. The app imports `apps/scanner` and `packages/core` from the monorepo |
| **Build and Deployment → Node.js Version** | `22.x` or `24.x` | Both meet the `>=22.19` engine requirement |

### 3.2 What each function does

The repo configures all of this; you don't need to change anything here.

| Route | Source | `maxDuration` | Notes |
|---|---|---|---|
| `GET /api/health` | `apps/web/src/app/api/health/route.ts` | default | `{ ok, version, queue }` |
| `GET /api/quota` | `…/api/quota/route.ts` | default | Remaining scans for the caller, AI availability, perf engine |
| `POST /api/scan/stream` | `…/api/scan/stream/route.ts` | **300** | One scan per call. The scanner stops itself at 270 s (`SCAN_DEADLINE_MS`) so the client always gets a clean `TIMEOUT` instead of a cut connection |
| `POST /api/export/pdf` | `…/api/export/pdf/route.ts` | **60** | Renders the PDF with the same Chromium. Report body ≤ 4 MB (Vercel's request limit is 4.5 MB) |

How the scan function gets a browser:

- **Chromium** comes from `@sparticuz/chromium` and is unpacked to `/tmp` on a cold start, which adds about 2–5 s. `next.config.ts` → `outputFileTracingIncludes` ships its binary with the two functions that need it.
- **Lighthouse** is excluded from the bundle (`outputFileTracingExcludes`). On Vercel, performance comes from PageSpeed Insights, or from the estimate when there's no key.
- **Serverless defaults** are applied automatically when the `VERCEL` variable is present. Set any of these as an environment variable to override it:

  | Variable | Vercel default | Meaning |
  |---|---|---|
  | `MAX_CONCURRENT_SCANS` | 3 | Scans running at once across all instances (Upstash gate). Callers wait up to 60 s with `queued` events |
  | `SITE_MAX_PAGES` | 5 | Pages per full-site scan |
  | `SITE_CONCURRENCY` | 1 | Pages scanned in parallel in site mode |
  | `SITE_BUDGET_MS` | 150000 | Time budget for the page loop in site mode |
  | `PAGE_BUDGET_MS` | 45000 | Time budget per page |
  | `PERF_MAX_PAGES_FULL` | 0 | Pages with a full performance run in site mode |
  | `AI_TIMEOUT_MS` / `AI_TOTAL_BUDGET_MS` | 20000 / 45000 | Per-provider timeout and total AI budget |
  | `SCAN_DEADLINE_MS` | 270000 | Hard stop for the whole scan |
  | `REPORT_MAX_BYTES` | 4000000 | Report size cap (screenshots are dropped first) |
  | `LIGHTHOUSE_ENABLED` | false | Lighthouse isn't shipped to the function |

- **The rate limits** (per IP: 5 single scans an hour and 15 a day, 1 full-site scan a day, 10 scans per target domain a day, 10 PDFs an hour) are stored in Upstash under `td:rl:*`. Daily budgets live under `td:daily:*`, and the concurrency gate is a sorted set.

### 3.3 Confirm it in the dashboard

Open **Project → Deployments → (latest) → Functions** (or the **Resources** tab). You should see:

- `/api/scan/stream` with **Max Duration 300s**, region **iad1**, memory **2 GB**
- `/api/export/pdf` with **Max Duration 60s**

If `/api/scan/stream` shows 60 s, Fluid Compute is off (see 3.1).

## Step 4: Validate the deployment

Run these from a local clone (`pnpm install` once). Replace the URL with yours.

### 4.1 Automated smoke test

```bash
pnpm health https://your-app.vercel.app --scan https://example.com
```

Expected output (timings vary; the first call includes a cold start):

```
✓ GET /api/health: version 1.0.0, scans running 0
✓ GET /api/quota: AI available, perf engine psi, 5 single scans left this hour
✓ refuses http://127.0.0.1/
✓ refuses http://169.254.169.254/latest/meta-data/
✓ refuses http://10.0.0.1/
    · Check the address (2 ms)
    · Read robots.txt and sitemap (601 ms)
    · Load page (418 ms)
    · …
    · Measure performance (…)
✓ scan https://example.com: 25 s, overall 91, 19 groups, perf psi, AI ok, screenshots 2
```

What each part proves:

| Line | Proves |
|---|---|
| `GET /api/health` | The functions build, bundle and start |
| `AI available` / `perf engine psi` | The AI and PSI keys are present (`unavailable` / `estimated` means a key is missing) |
| `refuses …` ×3 | The SSRF guard blocks loopback, cloud metadata and private ranges |
| The step list | The scan streams through the function step by step |
| `screenshots 2` | Serverless Chromium launched (desktop and mobile captures) |
| `perf psi`, `AI ok` | PageSpeed Insights and an AI provider answered within the budget |

A failure prints `✗` with the reason, and the command exits non-zero, so you can also use it in CI. Without `--scan` it only runs the cheap checks and doesn't use any scan quota.

### 4.2 The raw stream (optional)

To watch the event stream yourself:

```bash
curl -N -X POST https://your-app.vercel.app/api/scan/stream \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com","mode":"single"}'
```

You'll see `event: started`, then a series of `event: step` frames, `event: ai_started`, one large `event: report`, and finally `event: done`. Lines starting with `:` are heartbeats sent every 15 s. Errors that happen before the stream starts come back as plain JSON with an HTTP status, for example `422 {"error":{"code":"BLOCKED_TARGET",…}}`.

### 4.3 Logs and storage

- **Vercel → Project → Logs**, filtered to `/api/scan/stream`: each scan writes one JSON line such as `{"event":"scan","host":"example.com","mode":"single","outcome":"ok","ms":24811,"ai":"ok","perf":"psi"}`. Only the hostname is logged, never the full URL or the report.
- **Upstash → your database → Data Browser**: after a scan there are `td:rl:…` and `td:daily:…` keys. If you see none, the Upstash variables aren't reaching the function.

### 4.4 Manual checks in the browser

1. Open the site. The landing page loads, the sample teardown plays once, and the form shows "N single-page scans left this hour".
2. Scan a site you own. The bench log streams steps, and the sheet shows pins, the brand sheet and fixes. The performance readout says **PageSpeed Insights**, or **Estimate** if there's no key.
3. Download the PDF, the agent brief and the JSON.
4. Run a **Full site** scan of a small site. Pages stream in, up to 5.
5. Try `http://localhost`, `http://127.0.0.1` and `http://192.168.1.1`. Each one is refused with a clear message.
6. Keep scanning until you hit the hourly limit. The message tells you when you can scan again, and the limit survives a redeploy (that's the Upstash check).

### 4.5 Troubleshooting

| Symptom | Cause and fix |
|---|---|
| The build fails during install with pnpm errors | Add `ENABLE_EXPERIMENTAL_COREPACK=1` (step 2.4) and redeploy |
| The build fails with "Cannot find module '@teardown/…'" | The workspace packages weren't installed. Check that Root Directory is the repository root (step 3.1) and that the install step ran `pnpm install` at the root |
| Vercel asks you to configure services, or every page returns 404 | The root `vercel.json` is missing, or Root Directory points at `apps/web`, so Vercel never reads it. Set Root Directory back to the repository root |
| Every `/api` route returns 500 with `Cannot find module …/playwright-core/browsers.json` (or another file under `node_modules`) | A file the scanner reads at runtime wasn't traced into the function. Add it to `outputFileTracingIncludes` in `apps/web/next.config.ts` (use the real `node_modules/.pnpm/…` path, not only the symlinked one) and extend `apps/web/scripts/check-trace.mjs`, which CI runs after the build |
| `FUNCTION_INVOCATION_TIMEOUT` after exactly 60 s | Fluid Compute is off, so `maxDuration = 300` isn't honoured (step 3.1) |
| The scan finishes but says **reduced accuracy**, with `screenshots 0` | Chromium couldn't launch, so the HTML-only fallback ran. Check the function logs for the launch error. The usual cause is a missing `@sparticuz/chromium/bin` in the bundle, so confirm `outputFileTracingIncludes` in `apps/web/next.config.ts` is intact |
| `perf estimated` although `PSI_API_KEY` is set | The key is restricted to the wrong API, or the variable was added after the last deploy. Environment variable changes only apply to new deployments, so redeploy |
| `AI skipped` or `AI fallback` | No key, or every provider failed or was rate limited. The report is still complete. Run `pnpm ai:eval` locally to test the keys |
| Limits reset after every deploy or cold start | The Upstash variables are missing, or one of them has a typo |
| `QUEUE_FULL` under load | More than `MAX_CONCURRENT_SCANS` scans waited over 60 s. Raise the limit carefully, because each scan uses about 1 vCPU |
| PDF export returns `BAD_REQUEST` "too large" | The report is over 4 MB. Very image-heavy full-site reports can hit this, and the JSON and Markdown exports still work |

## Step 5: Finish up

1. **Custom domain (optional):** open **Settings → Domains**.
2. **Site URL:** set `NEXT_PUBLIC_SITE_URL` to your final URL, e.g. `https://teardown.example`. It's inlined at build time, so **redeploy** afterwards. It feeds the canonical URL and the Open Graph metadata.
3. **Robots and sitemap:** replace the domain in `apps/web/public/robots.txt` and `apps/web/public/sitemap.xml`, then commit.
4. **README:** add the live URL.
5. Re-run `pnpm health https://your-domain` to confirm.

## Free-tier budget

Vercel Hobby includes about 4 hours of active CPU a month. A single-page scan uses roughly 15–40 s of CPU, because performance runs on Google's side through PSI, so expect a few hundred scans a month. The global daily caps (`GLOBAL_SINGLE_PER_DAY`, `GLOBAL_SITE_PER_DAY`) keep usage inside that; lower them if **Usage** shows you getting close. Waiting in the gate and streaming idle time cost very little under Fluid Compute, which bills active CPU.

> **Vercel Hobby terms** (checked 2026-10-04): Hobby is for non-commercial personal use, and "commercial" includes a consultant earning from the site. A portfolio demo is fine; a lead-generation tool may not be.

## Local development

```bash
pnpm install
pnpm --filter @teardown/scanner exec playwright install chromium
cp .env.example .env
pnpm --filter @teardown/web dev                       # site + /api on http://localhost:3000
pnpm health http://localhost:3000 --scan https://example.com
```

Locally the functions use Playwright's Chromium instead of the serverless build, and the limits live in memory unless the Upstash variables are set. To test exactly what Vercel runs, use `pnpm --filter @teardown/web build && pnpm --filter @teardown/web start`.
