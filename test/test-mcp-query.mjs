/**
 * Quick test script for MCP server functionality
 */

import { DynamoDBClient, ScanCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { S3VectorsClient, QueryVectorsCommand, ListVectorsCommand } from '@anthropic-ai/bedrock-s3vectors';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const region = process.env.AWS_REGION || 'us-east-1';
const dynamoTable = process.env.DYNAMODB_TABLE || 'krisp-transcripts-index';
const vectorBucket = process.env.VECTOR_BUCKET || 'krisp-vectors-134563994646';
const vectorIndex = process.env.VECTOR_INDEX || 'transcript-chunks';

async function listTranscripts() {
  console.log('\n=== List Transcripts (DynamoDB) ===\n');

  const dynamo = new DynamoDBClient({ region });
  const result = await dynamo.send(new ScanCommand({
    TableName: dynamoTable,
    Limit: 10,
  }));

  for (const item of result.Items || []) {
    console.log(`- ${item.title?.S || 'Untitled'}`);
    console.log(`  ID: ${item.meeting_id?.S}`);
    console.log(`  Date: ${item.date?.S}`);
    console.log(`  Speakers: ${item.speakers?.L?.map(s => s.S).join(', ') || 'Unknown'}`);
    console.log('');
  }

  return result.Items;
}

async function generateEmbedding(text) {
  const bedrock = new BedrockRuntimeClient({ region });
  const response = await bedrock.send(new InvokeModelCommand({
    modelId: 'amazon.titan-embed-text-v1',
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({ inputText: text }),
  }));

  const result = JSON.parse(new TextDecoder().decode(response.body));
  return result.embedding;
}

async function searchTranscripts(query) {
  console.log(`\n=== Semantic Search: "${query}" ===\n`);

  try {
    // Generate embedding for query
    console.log('Generating query embedding...');
    const queryVector = await generateEmbedding(query);
    console.log(`Embedding dimension: ${queryVector.length}`);

    // Query vectors
    const vectors = new S3VectorsClient({ region });
    const result = await vectors.send(new QueryVectorsCommand({
      vectorBucketName: vectorBucket,
      indexName: vectorIndex,
      queryVector: { float32: queryVector },
      topK: 5,
    }));

    console.log('\nResults:');
    for (const match of result.vectors || []) {
      console.log(`- Key: ${match.key}`);
      console.log(`  Score: ${match.score?.toFixed(4)}`);
      if (match.metadata) {
        console.log(`  Meeting: ${match.metadata.meeting_id}`);
        console.log(`  Text: ${match.metadata.text?.substring(0, 100)}...`);
      }
      console.log('');
    }

    return result.vectors;
  } catch (error) {
    console.error('Search error:', error.message);
    return [];
  }
}

// Run tests
async function main() {
  console.log('MCP Server Query Test');
  console.log('=====================');
  console.log(`Region: ${region}`);
  console.log(`DynamoDB Table: ${dynamoTable}`);
  console.log(`Vector Bucket: ${vectorBucket}`);
  console.log(`Vector Index: ${vectorIndex}`);

  await listTranscripts();
  await searchTranscripts('Q1 roadmap and product features');
  await searchTranscripts('budget and costs');
}

main().catch(console.error);
