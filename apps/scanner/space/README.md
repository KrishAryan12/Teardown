---
title: Teardown Scanner
emoji: 🔩
colorFrom: blue
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
short_description: Website teardown scanner API (Playwright, Lighthouse)
---

# Teardown scanner

The API behind [Teardown](https://github.com/KrishAryan12/Teardown): it scans public web pages in headless Chromium and returns a report over server-sent events.

This Space is deployed automatically from the GitHub repository by `scripts/build-space.sh`. Don't edit files here; change them in the repo.

- `GET /health` — status and queue
- `GET /api/quota` — remaining allowances
- `POST /api/scan` — start a scan (`{ "url": "example.com", "mode": "single" }`)
- `GET /api/scan/:id/events` — progress and the report (SSE)

Configuration is via Space secrets and variables; see `.env.example` in the repository.
