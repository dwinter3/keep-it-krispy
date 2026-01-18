/**
 * Migration script to add user_id to all existing speakers
 * This assigns all existing speakers to the admin user for user isolation
 *
 * Usage: npx tsx scripts/migrate-speakers-user-id.ts
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'

const ADMIN_USER_ID = 'usr_admin_001'
const TABLE_NAME = 'krisp-speakers'
const AWS_REGION = 'us-east-1'

// Configure for local development with profile
const client = new DynamoDBClient({
  region: AWS_REGION,
})
const dynamodb = DynamoDBDocumentClient.from(client)

async function migrateSpeakers() {
  console.log('Starting speaker migration to add user_id...')
  console.log(`Assigning all speakers to user: ${ADMIN_USER_ID}`)

  let lastKey: Record<string, unknown> | undefined
  let totalUpdated = 0
  let totalSkipped = 0

  do {
    // Scan all speakers
    const scanCommand = new ScanCommand({
      TableName: TABLE_NAME,
      ExclusiveStartKey: lastKey,
      ProjectionExpression: '#name, user_id',
      ExpressionAttributeNames: {
        '#name': 'name',
      },
    })

    const response = await dynamodb.send(scanCommand)
    const items = response.Items || []

    console.log(`Processing batch of ${items.length} items...`)

    for (const item of items) {
      if (item.user_id) {
        console.log(`  Skipping ${item.name} (already has user_id: ${item.user_id})`)
        totalSkipped++
        continue
      }

      // Update the item to add user_id
      const updateCommand = new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { name: item.name },
        UpdateExpression: 'SET user_id = :userId',
        ExpressionAttributeValues: {
          ':userId': ADMIN_USER_ID,
        },
      })

      await dynamodb.send(updateCommand)
      console.log(`  Updated ${item.name}`)
      totalUpdated++
    }

    lastKey = response.LastEvaluatedKey
  } while (lastKey)

  console.log('\nMigration complete!')
  console.log(`  Updated: ${totalUpdated}`)
  console.log(`  Skipped: ${totalSkipped}`)
  console.log(`  Total: ${totalUpdated + totalSkipped}`)
}

// Run the migration
migrateSpeakers()
  .then(() => {
    console.log('\nDone!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('Migration failed:', error)
    process.exit(1)
  })
