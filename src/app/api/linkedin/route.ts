import { NextRequest, NextResponse } from 'next/server'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand, QueryCommand, BatchWriteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb'
import { auth } from '@/lib/auth'
import { getUserByEmail } from '@/lib/users'
import JSZip from 'jszip'

// Route segment config for file uploads
export const maxDuration = 60 // 60 seconds timeout
export const dynamic = 'force-dynamic'

const TABLE_NAME = 'krisp-linkedin-connections'
const AWS_REGION = process.env.APP_REGION || 'us-east-1'

const credentials = process.env.S3_ACCESS_KEY_ID ? {
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
} : undefined

const dynamoClient = new DynamoDBClient({ region: AWS_REGION, credentials })
const dynamodb = DynamoDBDocumentClient.from(dynamoClient)

/**
 * Normalize a name for fuzzy matching
 * - Lowercase
 * - Remove special characters
 * - Trim whitespace
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Parse CSV content into array of objects
 * Handles quoted fields with commas
 */
function parseCSV(content: string): Record<string, string>[] {
  const lines = content.split('\n')
  if (lines.length < 2) return []

  // Parse header row
  const headers = parseCSVLine(lines[0])

  const results: Record<string, string>[] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const values = parseCSVLine(line)
    const row: Record<string, string> = {}

    headers.forEach((header, index) => {
      row[header.trim()] = values[index]?.trim() || ''
    })

    results.push(row)
  }

  return results
}

/**
 * Parse a single CSV line, handling quoted fields
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]

    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += char
    }
  }

  result.push(current)
  return result
}

/**
 * POST /api/linkedin
 *
 * Upload and parse LinkedIn data export ZIP file.
 * Expects multipart form data with 'file' field containing the ZIP.
 */
export async function POST(request: NextRequest) {
  console.log('[LinkedIn Import] Starting import request')

  const session = await auth()
  if (!session?.user?.email) {
    console.log('[LinkedIn Import] Unauthorized - no session')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  console.log('[LinkedIn Import] User email:', session.user.email)

  const user = await getUserByEmail(session.user.email)
  if (!user) {
    console.log('[LinkedIn Import] User not found for email:', session.user.email)
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }
  console.log('[LinkedIn Import] User ID:', user.user_id)

  try {
    console.log('[LinkedIn Import] Parsing form data...')
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      console.log('[LinkedIn Import] No file in form data')
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }
    console.log('[LinkedIn Import] File received:', file.name, 'Size:', file.size, 'Type:', file.type)

    // Check file type
    if (!file.name.endsWith('.zip') && !file.name.endsWith('.csv')) {
      return NextResponse.json(
        { error: 'Invalid file type. Please upload a ZIP file from LinkedIn export or a Connections.csv file.' },
        { status: 400 }
      )
    }

    let csvContent: string

    if (file.name.endsWith('.zip')) {
      // Parse ZIP file
      console.log('[LinkedIn Import] Processing ZIP file...')
      const arrayBuffer = await file.arrayBuffer()
      console.log('[LinkedIn Import] ArrayBuffer size:', arrayBuffer.byteLength)

      const zip = await JSZip.loadAsync(arrayBuffer)
      console.log('[LinkedIn Import] ZIP loaded, files:', Object.keys(zip.files))

      // Find Connections.csv in the ZIP
      const connectionsFile = zip.file('Connections.csv')
      if (!connectionsFile) {
        console.log('[LinkedIn Import] Connections.csv not found in ZIP')
        return NextResponse.json(
          { error: 'Connections.csv not found in ZIP file. Make sure you uploaded a LinkedIn data export.' },
          { status: 400 }
        )
      }

      csvContent = await connectionsFile.async('string')
      console.log('[LinkedIn Import] CSV content length:', csvContent.length)
    } else {
      // Direct CSV upload
      console.log('[LinkedIn Import] Processing CSV file directly...')
      csvContent = await file.text()
      console.log('[LinkedIn Import] CSV content length:', csvContent.length)
    }

    // Parse CSV
    console.log('[LinkedIn Import] Parsing CSV...')
    const connections = parseCSV(csvContent)
    console.log('[LinkedIn Import] Parsed connections count:', connections.length)
    if (connections.length > 0) {
      console.log('[LinkedIn Import] First row keys:', Object.keys(connections[0]))
    }

    if (connections.length === 0) {
      return NextResponse.json(
        { error: 'No connections found in the file.' },
        { status: 400 }
      )
    }

    // Process and store connections
    const now = new Date().toISOString()
    let imported = 0
    let skipped = 0
    const errors: string[] = []

    // Process in batches of 25 (DynamoDB limit)
    const batchSize = 25
    for (let i = 0; i < connections.length; i += batchSize) {
      const batch = connections.slice(i, i + batchSize)
      const writeRequests = []

      for (const conn of batch) {
        // LinkedIn CSV headers: First Name, Last Name, Email Address, Company, Position, Connected On
        const firstName = conn['First Name'] || ''
        const lastName = conn['Last Name'] || ''
        const email = conn['Email Address'] || ''
        const company = conn['Company'] || ''
        const position = conn['Position'] || ''
        const connectedOn = conn['Connected On'] || ''

        // Skip if no email (required for deduplication)
        if (!email) {
          skipped++
          continue
        }

        const fullName = `${firstName} ${lastName}`.trim()
        const normalizedName = normalizeName(fullName)

        // Build search terms for fuzzy matching
        const searchTerms = [
          ...normalizeName(firstName).split(' '),
          ...normalizeName(lastName).split(' '),
          ...normalizeName(company).split(' '),
        ].filter(t => t.length > 1)

        writeRequests.push({
          PutRequest: {
            Item: {
              user_id: user.user_id,
              email: email.toLowerCase(),
              first_name: firstName,
              last_name: lastName,
              full_name: fullName,
              normalized_name: normalizedName,
              company,
              position,
              connected_on: connectedOn,
              search_terms: searchTerms,
              imported_at: now,
            },
          },
        })
      }

      if (writeRequests.length > 0) {
        try {
          console.log(`[LinkedIn Import] Writing batch ${Math.floor(i / batchSize) + 1}, items: ${writeRequests.length}`)
          await dynamodb.send(new BatchWriteCommand({
            RequestItems: {
              [TABLE_NAME]: writeRequests,
            },
          }))
          imported += writeRequests.length
          console.log(`[LinkedIn Import] Batch ${Math.floor(i / batchSize) + 1} complete, total imported: ${imported}`)
        } catch (err) {
          console.error('[LinkedIn Import] Batch write error:', err)
          errors.push(`Batch ${Math.floor(i / batchSize) + 1} failed: ${String(err)}`)
        }
      }
    }

    console.log(`[LinkedIn Import] Writing metadata, total imported: ${imported}`)
    // Store import metadata
    await dynamodb.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        user_id: user.user_id,
        email: '_metadata',
        total_connections: imported,
        last_import_at: now,
        import_source: file.name,
      },
    }))

    return NextResponse.json({
      success: true,
      imported,
      skipped,
      errors: errors.length > 0 ? errors : undefined,
      message: `Successfully imported ${imported} LinkedIn connections.`,
    })
  } catch (error) {
    console.error('[LinkedIn Import] FATAL ERROR:', error)
    console.error('[LinkedIn Import] Error name:', (error as Error).name)
    console.error('[LinkedIn Import] Error message:', (error as Error).message)
    console.error('[LinkedIn Import] Error stack:', (error as Error).stack)
    return NextResponse.json(
      { error: 'Failed to import LinkedIn data', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * GET /api/linkedin
 *
 * Get LinkedIn connections stats and list.
 * Query params:
 * - limit: Max connections to return (default 50)
 * - search: Filter by name
 */
export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await getUserByEmail(session.user.email)
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const { searchParams } = new URL(request.url)
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100)
  const search = searchParams.get('search')?.toLowerCase()

  try {
    // Get metadata
    const metadataCommand = new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'user_id = :userId AND email = :email',
      ExpressionAttributeValues: {
        ':userId': user.user_id,
        ':email': '_metadata',
      },
    })
    const metadataResult = await dynamodb.send(metadataCommand)
    const metadata = metadataResult.Items?.[0]

    // Query connections
    let connections: Record<string, unknown>[] = []

    if (search) {
      // Search by normalized name using GSI
      const searchCommand = new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'name-index',
        KeyConditionExpression: 'user_id = :userId AND begins_with(normalized_name, :search)',
        ExpressionAttributeValues: {
          ':userId': user.user_id,
          ':search': normalizeName(search),
        },
        Limit: limit,
      })
      const searchResult = await dynamodb.send(searchCommand)
      connections = (searchResult.Items || []).filter(c => c.email !== '_metadata')
    } else {
      // List all connections
      const listCommand = new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'user_id = :userId',
        ExpressionAttributeValues: {
          ':userId': user.user_id,
        },
        Limit: limit + 1, // +1 to account for metadata row
      })
      const listResult = await dynamodb.send(listCommand)
      connections = (listResult.Items || []).filter(c => c.email !== '_metadata')
    }

    return NextResponse.json({
      totalConnections: metadata?.total_connections || 0,
      lastImportAt: metadata?.last_import_at || null,
      importSource: metadata?.import_source || null,
      connections: connections.slice(0, limit).map(c => ({
        email: c.email,
        firstName: c.first_name,
        lastName: c.last_name,
        fullName: c.full_name,
        company: c.company,
        position: c.position,
        connectedOn: c.connected_on,
      })),
    })
  } catch (error) {
    console.error('LinkedIn list error:', error)
    return NextResponse.json(
      { error: 'Failed to list LinkedIn connections', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/linkedin
 *
 * Delete all LinkedIn connections for the user.
 */
export async function DELETE(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await getUserByEmail(session.user.email)
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  try {
    // Query all connections for this user
    let lastKey: Record<string, unknown> | undefined
    let deleted = 0

    do {
      const scanCommand = new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'user_id = :userId',
        ExpressionAttributeValues: {
          ':userId': user.user_id,
        },
        ProjectionExpression: 'user_id, email',
        ExclusiveStartKey: lastKey,
        Limit: 25,
      })
      const result = await dynamodb.send(scanCommand)
      lastKey = result.LastEvaluatedKey

      if (result.Items && result.Items.length > 0) {
        // Delete in batch
        const deleteRequests = result.Items.map(item => ({
          DeleteRequest: {
            Key: {
              user_id: item.user_id,
              email: item.email,
            },
          },
        }))

        await dynamodb.send(new BatchWriteCommand({
          RequestItems: {
            [TABLE_NAME]: deleteRequests,
          },
        }))

        deleted += result.Items.length
      }
    } while (lastKey)

    return NextResponse.json({
      success: true,
      deleted,
      message: `Deleted ${deleted} LinkedIn connections.`,
    })
  } catch (error) {
    console.error('LinkedIn delete error:', error)
    return NextResponse.json(
      { error: 'Failed to delete LinkedIn connections', details: String(error) },
      { status: 500 }
    )
  }
}
