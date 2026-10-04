// Lighthouse CI for the production build: the landing page must score 95+ in every category.
const { chromium } = require('playwright');

module.exports = {
  ci: {
    collect: {
      startServerCommand: 'node scripts/serve.mjs',
      startServerReadyPattern: 'serving the production build',
      url: ['http://127.0.0.1:3000/'],
      numberOfRuns: 5,
      chromePath: process.env.CHROME_PATH || chromium.executablePath(),
      settings: { chromeFlags: '--headless=new --no-sandbox' },
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.95, aggregationMethod: 'median-run' }],
        'categories:accessibility': ['error', { minScore: 0.95, aggregationMethod: 'median-run' }],
        'categories:best-practices': ['error', { minScore: 0.95, aggregationMethod: 'median-run' }],
        'categories:seo': ['error', { minScore: 0.95, aggregationMethod: 'median-run' }],
      },
    },
    upload: { target: 'filesystem', outputDir: './.lighthouseci' },
  },
};
