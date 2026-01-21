/**
 * User context and authentication for MCP server.
 *
 * Supports two authentication methods:
 * 1. KRISP_USER_ID environment variable (for local/Claude Desktop usage)
 * 2. API key lookup (for Lambda/HTTP endpoint usage)
 *
 * Priority: API key > environment variable
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { createHash } from 'crypto';

const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const API_KEYS_TABLE = 'krisp-api-keys';

export interface UserContext {
  userId: string;
  email?: string;
  source: 'api_key' | 'env_var';
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

// Lazy-initialized DynamoDB client
let docClient: DynamoDBDocumentClient | null = null;

function getDocClient(): DynamoDBDocumentClient {
  if (!docClient) {
    const dynamoClient = new DynamoDBClient({ region: AWS_REGION });
    docClient = DynamoDBDocumentClient.from(dynamoClient);
  }
  return docClient;
}

/**
 * Hash an API key using SHA256 (same as webhook Lambda)
 */
function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Look up user_id from an API key.
 * Returns null if key is invalid or revoked.
 */
async function getUserFromApiKey(apiKey: string): Promise<UserContext | null> {
  const keyHash = hashApiKey(apiKey);
  const client = getDocClient();

  try {
    // key_hash is the primary key - use GetCommand directly
    const command = new GetCommand({
      TableName: API_KEYS_TABLE,
      Key: { key_hash: keyHash },
    });

    const response = await client.send(command);
    const item = response.Item;

    if (item && item.status === 'active') {
      return {
        userId: item.user_id as string,
        email: item.email as string | undefined,
        source: 'api_key',
      };
    }

    return null;
  } catch (error) {
    // Table might not exist in some setups - fall through to env var
    console.error('[AUTH] API key lookup failed:', error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Get user context from environment variable.
 */
function getUserFromEnv(): UserContext | null {
  const userId = process.env.KRISP_USER_ID;
  if (userId) {
    return {
      userId,
      source: 'env_var',
    };
  }
  return null;
}

/**
 * Get user context from available sources.
 * Priority: API key (if provided) > KRISP_USER_ID env var
 *
 * @param apiKey - Optional API key from request header or parameter
 * @returns UserContext if authenticated, null otherwise
 */
export async function getUserContext(apiKey?: string): Promise<UserContext | null> {
  // Priority 1: API key (if provided)
  if (apiKey) {
    const apiKeyContext = await getUserFromApiKey(apiKey);
    if (apiKeyContext) {
      return apiKeyContext;
    }
  }

  // Priority 2: Environment variable
  const envContext = getUserFromEnv();
  if (envContext) {
    return envContext;
  }

  return null;
}

/**
 * Require a valid user context, throwing an error if not authenticated.
 * Use this for operations that must be scoped to a user.
 *
 * @param apiKey - Optional API key from request
 * @throws AuthError if no valid user context is found
 */
export async function requireUserContext(apiKey?: string): Promise<UserContext> {
  const context = await getUserContext(apiKey);

  if (!context) {
    throw new AuthError(
      'Authentication required. Set KRISP_USER_ID environment variable or provide valid API key.'
    );
  }

  return context;
}

/**
 * Debug helper to log auth context info (without sensitive data)
 */
export function debugAuthContext(context: UserContext | null): string {
  if (!context) {
    return 'No user context (unauthenticated)';
  }
  return `User: ${context.userId.substring(0, 8)}... (source: ${context.source})`;
}
