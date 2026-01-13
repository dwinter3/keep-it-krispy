import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    SITE_PASSWORD: process.env.SITE_PASSWORD || 'krispy2026',
    // AWS credentials and config for transcript/search access
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID || '',
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY || '',
    KRISP_S3_BUCKET: process.env.KRISP_S3_BUCKET || 'krisp-transcripts-754639201213',
    DYNAMODB_TABLE: process.env.DYNAMODB_TABLE || 'krisp-transcripts-index',
    VECTOR_BUCKET: process.env.VECTOR_BUCKET || 'krisp-vectors',
    VECTOR_INDEX: process.env.VECTOR_INDEX || 'transcript-chunks',
    APP_REGION: process.env.APP_REGION || 'us-east-1',
  },
};

export default nextConfig;
