import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    SITE_PASSWORD: process.env.SITE_PASSWORD || 'krispy2026',
  },
};

export default nextConfig;
