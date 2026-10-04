// Lighthouse CI for the static export: the landing page must score 95+ in every category.
const { chromium } = require('playwright');

module.exports = {
  ci: {
    collect: {
      staticDistDir: './out',
      url: ['http://localhost/'],
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
