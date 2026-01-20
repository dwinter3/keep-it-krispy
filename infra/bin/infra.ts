#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { KrispBuddyStack } from '../lib/infra-stack';

/**
 * Keep It Krispy - CDK App Entry Point
 *
 * Deploy: cd infra && npx cdk deploy --profile krisp-buddy
 * Diff:   cd infra && npx cdk diff --profile krisp-buddy
 * Synth:  cd infra && npx cdk synth
 *
 * IMPORTANT: All infrastructure changes must go through this CDK stack.
 * Manual AWS Console changes will cause drift and should be avoided.
 */
const app = new cdk.App();

new KrispBuddyStack(app, 'KrispBuddyStack', {
  stackName: 'krisp-buddy',
  description: 'Keep It Krispy - AI-Powered Meeting Memory Platform',
  env: {
    account: '754639201213',
    region: 'us-east-1',
  },
  tags: {
    Project: 'keep-it-krispy',
    Environment: 'production',
    ManagedBy: 'cdk',
    Repository: 'dwinter3/keep-it-krispy',
  },
});

app.synth();
