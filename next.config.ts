import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable standalone output for Docker deployment
  output: 'standalone',

  env: {
    // All sensitive values must be set via environment variables - no defaults
    SITE_PASSWORD: process.env.SITE_PASSWORD || '',
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID || '',
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY || '',
    KRISP_S3_BUCKET: process.env.KRISP_S3_BUCKET || '',
    DYNAMODB_TABLE: process.env.DYNAMODB_TABLE || '',
    VECTOR_BUCKET: process.env.VECTOR_BUCKET || '',
    VECTOR_INDEX: process.env.VECTOR_INDEX || '',
    APP_REGION: process.env.APP_REGION || 'us-east-1',
  },
};

export default nextConfig;
