import type { NextConfig } from 'next';

// Static export: the site is plain files on any static host (Vercel today, anything tomorrow).
const config: NextConfig = {
  output: 'export',
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@teardown/core'],
  images: { unoptimized: true },
  trailingSlash: true,
};

export default config;
