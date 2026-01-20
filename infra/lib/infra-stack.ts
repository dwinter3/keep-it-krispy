import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';

/**
 * Keep It Krispy - Main Infrastructure Stack
 *
 * All AWS resources are defined here as Infrastructure as Code.
 * Manual changes in AWS Console will cause drift and should be avoided.
 *
 * Deploy with: cd infra && npx cdk deploy --profile krisp-buddy
 *
 * Note: This stack imports existing Lambda functions and their IAM roles
 * to preserve function URLs and avoid breaking integrations.
 */
export class KrispBuddyStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const accountId = cdk.Stack.of(this).account;

    // ============================================================
    // S3 BUCKETS
    // ============================================================

    // Import existing transcripts bucket
    const transcriptsBucket = s3.Bucket.fromBucketName(
      this,
      'TranscriptsBucket',
      `krisp-transcripts-${accountId}`
    );

    // Import existing vectors bucket (or create if doesn't exist)
    const vectorsBucket = s3.Bucket.fromBucketName(
      this,
      'VectorsBucket',
      `krisp-vectors-${accountId}`
    );

    // ============================================================
    // DYNAMODB TABLES (all imported from existing)
    // ============================================================

    // Import all existing tables
    const transcriptsTable = dynamodb.Table.fromTableName(
      this, 'TranscriptsIndex', 'krisp-transcripts-index'
    );
    const speakersTable = dynamodb.Table.fromTableName(
      this, 'SpeakersTable', 'krisp-speakers'
    );
    const entitiesTable = dynamodb.Table.fromTableName(
      this, 'EntitiesTable', 'krisp-entities'
    );
    const relationshipsTable = dynamodb.Table.fromTableName(
      this, 'RelationshipsTable', 'krisp-relationships'
    );
    const documentsTable = dynamodb.Table.fromTableName(
      this, 'DocumentsTable', 'krisp-documents'
    );
    const usersTable = dynamodb.Table.fromTableName(
      this, 'UsersTable', 'krisp-users'
    );
    const apiKeysTable = dynamodb.Table.fromTableName(
      this, 'ApiKeysTable', 'krisp-api-keys'
    );
    const emailMappingTable = dynamodb.Table.fromTableName(
      this, 'EmailMappingTable', 'krisp-email-mapping'
    );
    const briefingsTable = dynamodb.Table.fromTableName(
      this, 'BriefingsTable', 'krisp-briefings'
    );
    const invitesTable = dynamodb.Table.fromTableName(
      this, 'InvitesTable', 'krisp-invites'
    );
    const auditLogsTable = dynamodb.Table.fromTableName(
      this, 'AuditLogsTable', 'krisp-audit-logs'
    );
    const companiesTable = dynamodb.Table.fromTableName(
      this, 'CompaniesTable', 'krisp-companies'
    );

    // ============================================================
    // LAMBDA FUNCTIONS (imported from existing)
    // ============================================================

    // Import existing Lambda functions to preserve their URLs
    // These functions are managed manually but referenced here for documentation
    const webhookFunction = lambda.Function.fromFunctionName(
      this, 'WebhookFunction', 'krisp-webhook-receiver'
    );
    const processorFunction = lambda.Function.fromFunctionName(
      this, 'ProcessorFunction', 'krisp-transcript-processor'
    );
    const briefingFunction = lambda.Function.fromFunctionName(
      this, 'MorningBriefingFunction', 'krisp-buddy-morning-briefing'
    );
    const enrichmentFunction = lambda.Function.fromFunctionName(
      this, 'SpeakerEnrichmentFunction', 'krisp-buddy-speaker-enrichment'
    );
    const mcpFunction = lambda.Function.fromFunctionName(
      this, 'McpServerFunction', 'krisp-mcp-server'
    );

    // ============================================================
    // GITHUB ACTIONS IAM ROLE (for CI/CD)
    // ============================================================

    // GitHub OIDC Provider
    const githubProvider = new iam.OpenIdConnectProvider(this, 'GitHubOIDCProvider', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });

    // GitHub Actions Role for CDK deployments
    const githubActionsRole = new iam.Role(this, 'GitHubActionsCDKRole', {
      roleName: 'GitHubActionsCDKRole',
      assumedBy: new iam.WebIdentityPrincipal(
        githubProvider.openIdConnectProviderArn,
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          },
          StringLike: {
            'token.actions.githubusercontent.com:sub': 'repo:dwinter3/keep-it-krispy:*',
          },
        }
      ),
      description: 'Role for GitHub Actions to deploy CDK stacks',
    });

    // Grant CDK deployment permissions
    githubActionsRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'cloudformation:*',
        'iam:*',
        'lambda:*',
        'dynamodb:*',
        's3:*',
        'events:*',
        'logs:*',
        'ssm:GetParameter',
        'sts:AssumeRole',
      ],
      resources: ['*'],
    }));

    // Grant access to CDK bootstrap bucket
    githubActionsRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:*'],
      resources: [
        `arn:aws:s3:::cdk-hnb659fds-assets-${accountId}-${this.region}`,
        `arn:aws:s3:::cdk-hnb659fds-assets-${accountId}-${this.region}/*`,
      ],
    }));

    // ============================================================
    // OUTPUTS
    // ============================================================

    new cdk.CfnOutput(this, 'WebhookFunctionName', {
      value: webhookFunction.functionName,
      description: 'Webhook Lambda function name',
    });

    new cdk.CfnOutput(this, 'McpServerFunctionName', {
      value: mcpFunction.functionName,
      description: 'MCP Server Lambda function name',
    });

    new cdk.CfnOutput(this, 'TranscriptsBucketName', {
      value: transcriptsBucket.bucketName,
    });

    new cdk.CfnOutput(this, 'VectorsBucketName', {
      value: vectorsBucket.bucketName,
    });

    new cdk.CfnOutput(this, 'GitHubActionsRoleArn', {
      value: githubActionsRole.roleArn,
      description: 'IAM Role ARN for GitHub Actions',
    });
  }
}
