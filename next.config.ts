import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    SITE_PASSWORD: process.env.SITE_PASSWORD || 'krispy2026',
    // S3 credentials for transcript access
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID || '',
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY || '',
    KRISP_S3_BUCKET: process.env.KRISP_S3_BUCKET || 'krisp-transcripts-754639201213',
  },
};

export default nextConfig;
