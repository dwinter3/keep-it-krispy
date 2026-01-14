/**
 * Test MCP server query functionality against test account
 */

const { DynamoDBClient, ScanCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

const region = process.env.AWS_REGION || 'us-east-1';
const dynamoTable = process.env.DYNAMODB_TABLE || 'krisp-transcripts-index';
const vectorBucket = process.env.VECTOR_BUCKET || 'krisp-vectors-134563994646';
const transcriptsBucket = process.env.KRISP_S3_BUCKET || 'krisp-transcripts-134563994646';

async function listTranscripts() {
  console.log('\n📋 LIST TRANSCRIPTS (DynamoDB)\n');
  console.log('─'.repeat(50));

  const dynamo = new DynamoDBClient({ region });
  const result = await dynamo.send(new ScanCommand({
    TableName: dynamoTable,
    Limit: 10,
  }));

  const transcripts = (result.Items || []).map(item => unmarshall(item));

  for (const t of transcripts) {
    console.log(`\n📄 ${t.title}`);
    console.log(`   Meeting ID: ${t.meeting_id}`);
    console.log(`   Date: ${t.date}`);
    console.log(`   Speakers: ${(t.speakers || []).join(', ')}`);
    console.log(`   S3 Key: ${t.s3_key}`);
  }

  return transcripts;
}

async function getTranscript(s3Key) {
  console.log(`\n📖 GET TRANSCRIPT: ${s3Key}\n`);
  console.log('─'.repeat(50));

  const s3 = new S3Client({ region });
  const result = await s3.send(new GetObjectCommand({
    Bucket: transcriptsBucket,
    Key: s3Key,
  }));

  const body = await result.Body.transformToString();
  const data = JSON.parse(body);

  // Extract transcript text
  const rawContent = data.raw_payload?.data?.raw_content || '';
  console.log('\nTranscript excerpt:');
  console.log('─'.repeat(30));
  console.log(rawContent.substring(0, 500) + (rawContent.length > 500 ? '...' : ''));

  return data;
}

async function generateEmbedding(query) {
  console.log('Generating query embedding with Bedrock Titan...');
  const bedrock = new BedrockRuntimeClient({ region });

  const embedResponse = await bedrock.send(new InvokeModelCommand({
    modelId: 'amazon.titan-embed-text-v1',
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({ inputText: query }),
  }));

  const embedResult = JSON.parse(new TextDecoder().decode(embedResponse.body));
  console.log(`Query embedding dimension: ${embedResult.embedding.length}`);
  return embedResult.embedding;
}

async function semanticSearch(query) {
  console.log(`\n🔍 SEMANTIC SEARCH: "${query}"\n`);
  console.log('─'.repeat(50));

  // Generate embedding for query
  const embedding = await generateEmbedding(query);

  // Try to use S3 Vectors SDK
  try {
    const { S3VectorsClient, QueryVectorsCommand } = require('@aws-sdk/client-s3vectors');

    const vectors = new S3VectorsClient({ region });
    const searchResult = await vectors.send(new QueryVectorsCommand({
      vectorBucketName: vectorBucket,
      indexName: 'transcript-chunks',
      queryVector: { float32: embedding },
      topK: 5,
    }));

    console.log('\nSearch Results:');
    for (const match of searchResult.vectors || []) {
      console.log(`\n  🎯 Key: ${match.key}`);
      console.log(`     Score: ${match.score?.toFixed(4)}`);
      if (match.metadata) {
        console.log(`     Meeting: ${match.metadata.meeting_id}`);
        console.log(`     Text: ${match.metadata.text?.substring(0, 150)}...`);
      }
    }

    return searchResult.vectors;
  } catch (err) {
    console.log(`\n⚠️  S3 Vectors query error: ${err.message}`);
    console.log('   (SDK may not be installed or vectors not yet indexed)');
    return [];
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║     Keep It Krispy - MCP Query Test              ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`\nConfig:`);
  console.log(`  Region: ${region}`);
  console.log(`  DynamoDB: ${dynamoTable}`);
  console.log(`  Transcripts: ${transcriptsBucket}`);
  console.log(`  Vectors: ${vectorBucket}`);

  // 1. List transcripts
  const transcripts = await listTranscripts();

  // 2. Get one transcript
  if (transcripts.length > 0) {
    const firstKey = transcripts.find(t => t.s3_key)?.s3_key;
    if (firstKey) {
      await getTranscript(firstKey);
    }
  }

  // 3. Semantic search
  await semanticSearch('Q1 roadmap discussion');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
