# Decisions log

One entry per decision: what, why, and the alternative considered. Verified facts carry the date they were checked.
Newest entries are appended at the end of each section.

## Verified external facts (checked 2026-10-04)

| Topic | What the official docs say today | Consequence for Teardown |
|---|---|---|
| **HF Spaces, Docker SDK** | `sdk: docker` + `app_port` in README front matter; container runs as UID 1000; secrets are runtime env vars; CPU Basic = 2 vCPU / 16 GB / 50 GB ephemeral disk; outbound traffic allowed on ports **80, 443 and 8080 only**; free hardware sleeps when unused. **New:** the Spaces overview now says *"Gradio and Docker Spaces run on compute and require a paid plan to create: PRO for personal accounts"*. Static Spaces stay free. | This conflicts with the zero-spend rule. See decision D-01. |
| **HF Inference Providers** | OpenAI-compatible router at `https://router.huggingface.co/v1/chat/completions`. Model id suffixes: `:fastest` (default), `:cheapest`, `:preferred`, or a provider name such as `:novita`. Free users get **$0.10/month** of credit ("subject to change"); more needs purchased credit. | Third in the chain, own daily cap (`AI_DAILY_CALLS_HUGGINGFACE`, default 20). Default model `meta-llama/Llama-3.1-8B-Instruct:cheapest`. |
| **Gemini (AI Studio)** | Rate-limit page no longer publishes free-tier numbers; it points to the per-project AI Studio dashboard. Current stable ids include `gemini-3.8-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`. `gemini-2.0-flash(-lite)` and `gemini-3.1-flash-lite-preview` are **shut down**. OpenAI-compatible endpoint: `https://generativelanguage.googleapis.com/v1beta/openai/`, supports `reasoning_effort` (`none` disables thinking on models that allow it). | Default `GEMINI_MODELS=gemini-3.5-flash-lite,gemini-3.1-flash-lite`. We send `reasoning_effort: "none"` and retry without it if the model rejects the parameter. Daily cap is conservative (default 200) because the free numbers are not published. |
| **Groq** | Rate-limit docs show a summary table and point to the per-org Limits page. `llama-3.1-8b-instant` is a production model. JSON Object mode works on all models; strict `json_schema` only on gpt-oss and qwen. | Default `GROQ_MODELS=llama-3.1-8b-instant`, `response_format: json_object`. One report call is ~4.5k tokens, so we keep one call per scan. Default daily cap 300. |
| **OpenRouter** | `:free` models: 20 requests/minute, **50/day** without purchased credit (1000/day after buying $10). | Last resort; `AI_DAILY_CALLS_OPENROUTER` default 40. |
| **PageSpeed Insights API** | `https://www.googleapis.com/pagespeedonline/v5/runPagespeed`, key recommended. The getting-started page no longer prints the quota; the commonly cited figure is 25,000/day per project. | Optional engine. `PSI_DAILY_CAP` default 500, far below any plausible quota. |
| **Vercel Hobby** | Fair-use page (updated 2026-09-14): Hobby is for **non-commercial personal use**; commercial means financial gain for anyone involved, *including a consultant writing the code*; "advertising the sale of a product or service" is listed. | A lead-gen tool for a freelancer could count as commercial. The frontend is a plain static export with no Vercel APIs, so it can move to Cloudflare Pages/Netlify/GitHub Pages unchanged. Flagged to the owner. |
| **Lighthouse** | Node API `lighthouse(url, flags, config)`; with `flags.port` it attaches to an existing Chrome with remote debugging. Requires Node >= 22.19. | We launch Playwright's Chromium via `chrome-launcher` (`chromePath = chromium.executablePath()`) with the proxy flags, then pass its port. |
| **Package versions** | Checked with `npm view` on 2026-10-04: playwright 1.63.0, lighthouse 13.5.0, next 16.3.8, react 19.3.0, fastify 5.12.5, zod 4.6.5, vitest 5.0.3, eslint 10.12.0, typescript-eslint 8.71.0, sharp 0.35.5, pnpm 12.9.1. | Ranges pinned to those majors. |
| **TypeScript** | `latest` is 7.0.2 (the native port) which ships no classic compiler API; typescript-eslint 8.71 supports `>=4.8.4 <6.1.0`. | Pinned `typescript ~6.0.3`. Revisit when typescript-eslint supports 7. |
| **pnpm 12** | `onlyBuiltDependencies` is replaced by `allowBuilds` (map of package -> boolean); unreviewed builds fail installs by default. | `pnpm-workspace.yaml` uses `allowBuilds`. |

## Decisions

**D-01. Scanner hosting: keep HF Spaces as the documented target, keep the container portable.**
HF now documents Docker Spaces as needing PRO to create. Some existing free accounts can still create them and the policy may differ by account, so the deploy path from the brief stays (`scripts/build-space.sh`, `deploy-scanner.yml`). The container listens on `$PORT` (default 7860), so the same image runs on any free container host. `docs/DEPLOY.md` lists a fallback (Render free web service via its Docker runtime: 512 MB RAM is tight for Chromium, so run with `MAX_CONCURRENT_SCANS=1` and `PERF_ENGINE=estimate` or `psi`). *Alternative:* switching the brief's target outright; rejected because the owner chose HF and may be able to use it.

**D-02. Monorepo tooling.** pnpm workspaces, TypeScript everywhere, ESM. `packages/core` is consumed as TypeScript source (no build step) by vitest, Next (`transpilePackages`) and esbuild. *Alternative:* building core to `dist` with project references; more moving parts for no benefit.

**D-03. Scanner build.** esbuild bundles `apps/scanner/src/main.ts` (with `@teardown/core` inlined) to `dist/main.js`; runtime dependencies stay external and are installed in the image. Code that runs inside scanned pages lives as plain JS files in `apps/scanner/inpage/`, read at runtime, because bundler/tsx helpers (`__name`) break functions passed to `page.evaluate`. *Alternative:* running `tsx` in production; slower boot and the same evaluate problem.

**D-04. Schema additions beyond the brief (all additive, still `teardown.report/v1`).** `Finding.evidence.ref` (axe rule id / Lighthouse audit id), `Finding.fix.verify`, `Page.screenshotSize`, `Page.ruleCounts`, `Page.scores`, `Page.metrics`, `Group.category`, `Group.title`, `BrandProfile.typeScaleRatio`, `BrandProfile.contrastUnknown`, `BrandProfile.fonts[].rendered`, `Report.reducedAccuracy`, `Report.limits.screenshotsDropped/notes`, `Report.lighthouse.metrics`. They make the UI and exports self-contained without recomputation.

**D-05. Markdown hardening.** All page-derived text in the agent brief is flattened to one line, Markdown-escaped, and selectors are placed in backtick-safe code spans. The brief tells the agent that quoted page text is data, not instructions.

**D-06. Rules run on serialisable page facts.** One in-page script collects a `PageFacts` object; rules are pure functions of it. Rules are unit-testable without a browser, and the Chromium-down fallback fills the same `PageFacts` from static HTML (linkedom) with layout fields empty.

**D-07. Rule de-duplication.** One concept is reported once. Our rules supersede overlapping axe rules (image-alt, html-has-lang, label, select-name, target-size, heading-order, page-has-heading-one, landmark-one-main, link-name, bypass). axe keeps color-contrast; the UX contrast rule only reports when axe didn't run. The SEO alt-text check is reported once, under accessibility (`a11y.img.alt`).

**D-08. Spacing grid tries 8, 4, then 5px.** The brief says 4 and 8; GOV.UK (a reference-quality site) uses a 5px scale and was wrongly flagged as off-grid. *Alternative:* 4/8 only.

**D-09. Tap targets apply the WCAG 2.5.8 spacing and inline exceptions** and skip visually hidden elements, after a real scan of gov.uk showed false positives.

**D-10. Performance estimate** = 0.7 x resource score + 0.3 x performance rule score (see RULES.md). Weighted towards measured bytes/requests so a heavy page can't score well on rules alone.

**D-11. Lighthouse 13 "insight" audits** are mapped onto our rules where they overlap (image-delivery, render-blocking, document-latency, viewport); bare diagnostics such as bf-cache are skipped.

**D-12. AI defaults (pre-eval).** Gemini `gemini-3.5-flash-lite,gemini-3.1-flash-lite` with `reasoning_effort: none` (dropped automatically if rejected); Groq `llama-3.1-8b-instant`; HF `meta-llama/Llama-3.1-8B-Instruct:cheapest` (verified on the router at $0.02/$0.05 per M tokens); OpenRouter `google/gemma-4-26b-a4b-it:free,google/gemma-4-31b-it:free` (verified in the live :free list, both support response_format). **`pnpm ai:eval` has not been run yet: no provider keys are available locally.** Defaults must be confirmed from eval results once keys are added.

**D-13. AI output hardening.** Unknown group ids are discarded, ranks renumbered, skipped groups appended deterministically, rationale capped at 20 words and instructions at ~50, off-site links and markup stripped. Invalid output gets one "valid JSON only" retry, then the chain advances. Circuit breaker: 429 = 30 min, 401/402/403/404/retired = 6 h, two invalid replies in a row = 30 min.

**D-14. Limits storage.** Fixed-window counters aligned to UTC hours/days in memory behind a `RateStore` interface (Upstash can replace it). Counters reset on restart or sleep; accepted for v1. Refused requests never consume allowance (check everything, then increment). A cache hit is served without spending scan limits, PSI or AI budget; "Scan again now" (`fresh: true`) counts.

**D-15. Client IP on HF Spaces.** HF's proxy forwards the client in `X-Forwarded-For`. Fastify trusts exactly `TRUST_PROXY_HOPS` (default 1) proxies, so a client-supplied `X-Forwarded-For` can't spoof the address used for rate limits. Set `TRUST_PROXY_HOPS=0` when running without a reverse proxy.

**D-16. PDF rendering is sandboxed.** The PDF endpoint accepts a client-supplied report, so it is zod-validated, every string is HTML-escaped, image sources must be strict base64 data URLs, and the page renders with JavaScript disabled and every network request aborted. The cover is full-bleed via `@page :first { margin: 0 }`.

**D-17. Fonts.** Google Fonts merged "Big Shoulders Display" into **Big Shoulders** (opsz 10–72), so the web app uses `Big_Shoulders` (optical size follows font size, giving the display cut at headline sizes). The PDF embeds the `@fontsource/big-shoulders-display` files, which are the same design. Big Shoulders and Public Sans use `display: optional` (no late swap of the LCP text; Big Shoulders has no metric-matched fallback); Martian Mono is not preloaded.

**D-18. Landing JS budget.** 138 KB gzipped for modern browsers (the 39 KB `nomodule` polyfill chunk is never fetched by them). The report UI, bench log and sample teaser are code-split. The web app imports only zod-free subpaths of `@teardown/core` (`/scoring`, `/exporters`, `/tokens`).

**D-19. CI runs the web checks against a static mock scanner** (`NEXT_PUBLIC_SCANNER_URL=/__mock` plus `scripts/mock-scanner.mjs`), so the warm-up ping succeeds and Lighthouse doesn't penalise console errors from a missing backend. Lighthouse CI asserts 95+ on the median of 5 mobile runs.

**D-20. Local Lighthouse numbers are noisy on the development machine** (OneDrive syncing the repo and other background load put the CPU at ~64%). Same-build runs ranged 0.83–0.95 for performance; accessibility, best practices and SEO were 100. Performance is judged on the clean CI runner. Changes made for it: deferred layout of below-the-fold sections (`content-visibility`), idle-time warm-up ping, lazy bench log, no mono font preload.

**D-21. Sample report.** Generated from a purpose-built demo shop page (`fixtures/pages/sample/`) through the full pipeline, with the local origin rewritten to `kilnandco.example`. Findings that only exist because the fixture is served locally (no HTTPS/HSTS, made-up shop links returning 404) are removed and scores recomputed.

**D-22. Pins never overlap.** Pins are 26px buttons; when two land within 28px they fan out sideways (then down). This keeps them WCAG 2.5.8-compliant targets and tappable on phones. Hover and focus never scroll the page; only opening a task from a pin does.
