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
 */
export class KrispBuddyStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const accountId = cdk.Stack.of(this).account;

    // ============================================================
    // S3 BUCKETS
    // ============================================================

    const transcriptsBucket = new s3.Bucket(this, 'TranscriptsBucket', {
      bucketName: `krisp-transcripts-${accountId}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const vectorsBucket = new s3.Bucket(this, 'VectorsBucket', {
      bucketName: `krisp-vectors-${accountId}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ============================================================
    // DYNAMODB TABLES
    // ============================================================

    // Transcripts Index
    const transcriptsTable = new dynamodb.Table(this, 'TranscriptsIndex', {
      tableName: 'krisp-transcripts-index',
      partitionKey: { name: 'meeting_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    transcriptsTable.addGlobalSecondaryIndex({
      indexName: 'date-index',
      partitionKey: { name: 'date', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'meeting_id', type: dynamodb.AttributeType.STRING },
    });
    transcriptsTable.addGlobalSecondaryIndex({
      indexName: 'speaker-index',
      partitionKey: { name: 'speaker_name', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'date', type: dynamodb.AttributeType.STRING },
    });
    transcriptsTable.addGlobalSecondaryIndex({
      indexName: 'all-transcripts-index',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
    });
    transcriptsTable.addGlobalSecondaryIndex({
      indexName: 'user-index',
      partitionKey: { name: 'user_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
    });

    // Speakers table
    const speakersTable = new dynamodb.Table(this, 'SpeakersTable', {
      tableName: 'krisp-speakers',
      partitionKey: { name: 'name', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Entities table
    const entitiesTable = new dynamodb.Table(this, 'EntitiesTable', {
      tableName: 'krisp-entities',
      partitionKey: { name: 'entity_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    entitiesTable.addGlobalSecondaryIndex({
      indexName: 'user-type-index',
      partitionKey: { name: 'user_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'entity_type', type: dynamodb.AttributeType.STRING },
    });
    entitiesTable.addGlobalSecondaryIndex({
      indexName: 'type-name-index',
      partitionKey: { name: 'entity_type', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'canonical_name', type: dynamodb.AttributeType.STRING },
    });
    entitiesTable.addGlobalSecondaryIndex({
      indexName: 'team-type-index',
      partitionKey: { name: 'team_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'entity_type', type: dynamodb.AttributeType.STRING },
    });

    // Relationships table
    const relationshipsTable = new dynamodb.Table(this, 'RelationshipsTable', {
      tableName: 'krisp-relationships',
      partitionKey: { name: 'relationship_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    relationshipsTable.addGlobalSecondaryIndex({
      indexName: 'from-index',
      partitionKey: { name: 'from_entity_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'rel_type', type: dynamodb.AttributeType.STRING },
    });
    relationshipsTable.addGlobalSecondaryIndex({
      indexName: 'to-index',
      partitionKey: { name: 'to_entity_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'rel_type', type: dynamodb.AttributeType.STRING },
    });
    relationshipsTable.addGlobalSecondaryIndex({
      indexName: 'user-type-index',
      partitionKey: { name: 'user_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'rel_type', type: dynamodb.AttributeType.STRING },
    });

    // Documents table
    const documentsTable = new dynamodb.Table(this, 'DocumentsTable', {
      tableName: 'krisp-documents',
      partitionKey: { name: 'document_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    documentsTable.addGlobalSecondaryIndex({
      indexName: 'user-index',
      partitionKey: { name: 'user_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'created_at', type: dynamodb.AttributeType.STRING },
    });
    documentsTable.addGlobalSecondaryIndex({
      indexName: 'hash-index',
      partitionKey: { name: 'file_hash', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY,
    });

    // Users table
    const usersTable = new dynamodb.Table(this, 'UsersTable', {
      tableName: 'krisp-users',
      partitionKey: { name: 'user_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    usersTable.addGlobalSecondaryIndex({
      indexName: 'email-index',
      partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING },
    });

    // API Keys table
    const apiKeysTable = new dynamodb.Table(this, 'ApiKeysTable', {
      tableName: 'krisp-api-keys',
      partitionKey: { name: 'api_key', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    apiKeysTable.addGlobalSecondaryIndex({
      indexName: 'user-index',
      partitionKey: { name: 'user_id', type: dynamodb.AttributeType.STRING },
    });
    apiKeysTable.addGlobalSecondaryIndex({
      indexName: 'keyid-index',
      partitionKey: { name: 'key_hash', type: dynamodb.AttributeType.STRING },
    });

    // Email Mapping table
    const emailMappingTable = new dynamodb.Table(this, 'EmailMappingTable', {
      tableName: 'krisp-email-mapping',
      partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Briefings table
    const briefingsTable = new dynamodb.Table(this, 'BriefingsTable', {
      tableName: 'krisp-briefings',
      partitionKey: { name: 'briefing_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    briefingsTable.addGlobalSecondaryIndex({
      indexName: 'user-date-index',
      partitionKey: { name: 'user_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'date', type: dynamodb.AttributeType.STRING },
    });

    // Invites table
    const invitesTable = new dynamodb.Table(this, 'InvitesTable', {
      tableName: 'krisp-invites',
      partitionKey: { name: 'invite_token', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      timeToLiveAttribute: 'ttl',
    });
    invitesTable.addGlobalSecondaryIndex({
      indexName: 'inviter-index',
      partitionKey: { name: 'inviter_id', type: dynamodb.AttributeType.STRING },
    });
    invitesTable.addGlobalSecondaryIndex({
      indexName: 'email-index',
      partitionKey: { name: 'invitee_email', type: dynamodb.AttributeType.STRING },
    });

    // Audit Logs table
    const auditLogsTable = new dynamodb.Table(this, 'AuditLogsTable', {
      tableName: 'krisp-audit-logs',
      partitionKey: { name: 'log_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    auditLogsTable.addGlobalSecondaryIndex({
      indexName: 'actor-index',
      partitionKey: { name: 'actor_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
    });
    auditLogsTable.addGlobalSecondaryIndex({
      indexName: 'target-index',
      partitionKey: { name: 'target_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
    });

    // Companies table
    const companiesTable = new dynamodb.Table(this, 'CompaniesTable', {
      tableName: 'krisp-companies',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    companiesTable.addGlobalSecondaryIndex({
      indexName: 'all-companies-index',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'mentionCount', type: dynamodb.AttributeType.NUMBER },
    });

    // ============================================================
    // LAMBDA FUNCTIONS
    // ============================================================

    // Webhook Lambda Role
    const webhookRole = new iam.Role(this, 'WebhookLambdaRole', {
      roleName: 'krisp-buddy-webhook-role',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });
    transcriptsBucket.grantPut(webhookRole);
    transcriptsTable.grantWriteData(webhookRole);
    apiKeysTable.grantReadData(webhookRole);

    // Webhook Lambda
    const webhookFunction = new lambda.Function(this, 'WebhookFunction', {
      functionName: 'krisp-webhook-receiver',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.lambda_handler',
      code: lambda.Code.fromAsset('../lambda'),
      role: webhookRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 128,
      environment: {
        KRISP_S3_BUCKET: transcriptsBucket.bucketName,
        DYNAMODB_TABLE: transcriptsTable.tableName,
      },
    });

    // Webhook Function URL
    const webhookUrl = webhookFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedMethods: [lambda.HttpMethod.POST],
        allowedOrigins: ['*'],
      },
    });

    // Processor Lambda Role
    const processorRole = new iam.Role(this, 'ProcessorLambdaRole', {
      roleName: 'krisp-buddy-processor-role',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });
    transcriptsBucket.grantRead(processorRole);
    transcriptsTable.grantReadWriteData(processorRole);
    companiesTable.grantReadWriteData(processorRole);
    processorRole.addToPolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
        `arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-lite-v1:0`,
      ],
    }));

    // Processor Lambda
    const processorFunction = new lambda.Function(this, 'ProcessorFunction', {
      functionName: 'krisp-transcript-processor',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('../lambda/processor'),
      role: processorRole,
      timeout: cdk.Duration.seconds(120),
      memorySize: 512,
      environment: {
        KRISP_S3_BUCKET: transcriptsBucket.bucketName,
        DYNAMODB_TABLE: transcriptsTable.tableName,
        VECTOR_BUCKET: vectorsBucket.bucketName,
        VECTOR_INDEX: 'transcript-chunks',
      },
    });

    // Morning Briefing Lambda Role
    const briefingRole = new iam.Role(this, 'MorningBriefingLambdaRole', {
      roleName: 'krisp-buddy-morning-briefing-role',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });
    transcriptsBucket.grantRead(briefingRole);
    transcriptsTable.grantReadData(briefingRole);
    usersTable.grantReadData(briefingRole);
    briefingsTable.grantReadWriteData(briefingRole);
    briefingRole.addToPolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [`arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-lite-v1:0`],
    }));

    // Morning Briefing Lambda
    const briefingFunction = new lambda.Function(this, 'MorningBriefingFunction', {
      functionName: 'krisp-buddy-morning-briefing',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('../lambda/morning-briefing'),
      role: briefingRole,
      timeout: cdk.Duration.seconds(300),
      memorySize: 512,
      environment: {
        KRISP_S3_BUCKET: transcriptsBucket.bucketName,
        DYNAMODB_TABLE: transcriptsTable.tableName,
        BRIEFINGS_TABLE: briefingsTable.tableName,
        USERS_TABLE: usersTable.tableName,
        BRIEFING_MODEL_ID: 'amazon.nova-lite-v1:0',
      },
    });

    // Morning Briefing Schedule
    const briefingRule = new events.Rule(this, 'MorningBriefingSchedule', {
      ruleName: 'krisp-buddy-morning-briefing-schedule',
      schedule: events.Schedule.cron({ minute: '0', hour: '7' }),
    });
    briefingRule.addTarget(new targets.LambdaFunction(briefingFunction));

    // Speaker Enrichment Lambda Role
    const enrichmentRole = new iam.Role(this, 'SpeakerEnrichmentLambdaRole', {
      roleName: 'krisp-buddy-speaker-enrichment-role',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });
    transcriptsBucket.grantRead(enrichmentRole);
    transcriptsTable.grantReadData(enrichmentRole);
    speakersTable.grantReadWriteData(enrichmentRole);
    entitiesTable.grantReadWriteData(enrichmentRole);
    enrichmentRole.addToPolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [`arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-lite-v1:0`],
    }));

    // Speaker Enrichment Lambda
    const enrichmentFunction = new lambda.Function(this, 'SpeakerEnrichmentFunction', {
      functionName: 'krisp-buddy-speaker-enrichment',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('../lambda/speaker-enrichment'),
      role: enrichmentRole,
      timeout: cdk.Duration.seconds(600),
      memorySize: 512,
      environment: {
        KRISP_S3_BUCKET: transcriptsBucket.bucketName,
        DYNAMODB_TABLE: transcriptsTable.tableName,
        SPEAKERS_TABLE: speakersTable.tableName,
        ENTITIES_TABLE: entitiesTable.tableName,
        MODEL_ID: 'amazon.nova-lite-v1:0',
      },
    });

    // Speaker Enrichment Schedule
    const enrichmentRule = new events.Rule(this, 'SpeakerEnrichmentSchedule', {
      ruleName: 'krisp-buddy-speaker-enrichment-schedule',
      schedule: events.Schedule.cron({ minute: '0', hour: '2' }),
    });
    enrichmentRule.addTarget(new targets.LambdaFunction(enrichmentFunction));

    // MCP Server Lambda Role
    const mcpRole = new iam.Role(this, 'McpServerLambdaRole', {
      roleName: 'krisp-buddy-mcp-server-role',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });
    transcriptsBucket.grantRead(mcpRole);
    transcriptsTable.grantReadData(mcpRole);
    speakersTable.grantReadData(mcpRole);
    companiesTable.grantReadData(mcpRole);

    // MCP Server Lambda
    const mcpFunction = new lambda.Function(this, 'McpServerFunction', {
      functionName: 'krisp-mcp-server',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('../lambda/mcp-server-ts'),
      role: mcpRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        KRISP_S3_BUCKET: transcriptsBucket.bucketName,
        DYNAMODB_TABLE: transcriptsTable.tableName,
        SPEAKERS_TABLE: speakersTable.tableName,
        COMPANIES_TABLE: companiesTable.tableName,
        VECTOR_BUCKET: vectorsBucket.bucketName,
        VECTOR_INDEX: 'transcript-chunks',
      },
    });

    // MCP Server Function URL
    const mcpUrl = mcpFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedMethods: [lambda.HttpMethod.POST],
        allowedOrigins: ['*'],
      },
    });

    // ============================================================
    // OUTPUTS
    // ============================================================

    new cdk.CfnOutput(this, 'WebhookUrl', {
      value: webhookUrl.url,
      description: 'Webhook URL for Krisp integration',
    });

    new cdk.CfnOutput(this, 'McpServerUrl', {
      value: mcpUrl.url,
      description: 'MCP Server URL for Claude integration',
    });

    new cdk.CfnOutput(this, 'TranscriptsBucketName', {
      value: transcriptsBucket.bucketName,
    });

    new cdk.CfnOutput(this, 'VectorsBucketName', {
      value: vectorsBucket.bucketName,
    });
  }
}
