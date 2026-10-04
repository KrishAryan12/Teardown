# Teardown scanner. Built from the flattened folder produced by scripts/build-space.sh
# (repo layout preserved: package.json, pnpm-lock.yaml, packages/core, apps/scanner).
#
# Base: the official Playwright image matching the playwright npm version, so Chromium and its
# system dependencies (fonts included) are already installed under /ms-playwright.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

ENV NODE_ENV=production \
    PORT=7860 \
    HOST=0.0.0.0 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    HOME=/home/teardown \
    NEXT_TELEMETRY_DISABLED=1

RUN npm install -g pnpm@12.9.1 \
 && mkdir -p /app /home/teardown \
 && chown -R 1000:1000 /app /home/teardown

WORKDIR /app

# HF Spaces runs containers as UID 1000; build and run as that user.
USER 1000

COPY --chown=1000:1000 package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=1000:1000 packages/core/package.json packages/core/
COPY --chown=1000:1000 apps/scanner/package.json apps/scanner/
COPY --chown=1000:1000 apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter "@teardown/scanner..."

COPY --chown=1000:1000 packages/core packages/core
COPY --chown=1000:1000 apps/scanner apps/scanner
RUN pnpm --filter @teardown/scanner build

EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||7860)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Secrets (API keys, ALLOWED_ORIGINS) arrive as runtime environment variables, never baked in.
CMD ["node", "apps/scanner/dist/main.js"]
