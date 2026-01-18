#!/usr/bin/env npx ts-node
/**
 * Seed script to create the initial admin user with multiple email aliases
 *
 * Usage:
 *   npx ts-node scripts/seed-admin-user.ts
 *
 * This creates:
 * - Admin user with user_id
 * - Email mappings for both davewinter@gmail.com and dw@choruscap.ai
 * - Both emails point to the same user account
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb'
import { fromIni } from '@aws-sdk/credential-provider-ini'

const client = new DynamoDBClient({
  region: 'us-east-1',
  credentials: fromIni({ profile: 'krisp-buddy' }),
})
const docClient = DynamoDBDocumentClient.from(client)

const USERS_TABLE = 'krisp-users'
const EMAIL_MAPPING_TABLE = 'krisp-email-mapping'

const ADMIN_USER_ID = 'usr_admin_001'
const ADMIN_EMAILS = ['davewinter@gmail.com', 'dw@choruscap.ai']
const ADMIN_NAME = 'David Winter'

async function seedAdminUser() {
  const now = new Date().toISOString()

  // Check if admin user already exists
  const existing = await docClient.send(new GetCommand({
    TableName: USERS_TABLE,
    Key: { user_id: ADMIN_USER_ID },
  }))

  if (existing.Item) {
    console.log('Admin user already exists:', existing.Item)
    return
  }

  // Create admin user
  const adminUser = {
    user_id: ADMIN_USER_ID,
    primary_email: ADMIN_EMAILS[0],
    email_aliases: ADMIN_EMAILS.slice(1),
    name: ADMIN_NAME,
    role: 'admin',
    created_at: now,
    updated_at: now,
    settings: {
      timezone: 'America/New_York',
      default_privacy: 'normal',
    },
  }

  await docClient.send(new PutCommand({
    TableName: USERS_TABLE,
    Item: adminUser,
  }))
  console.log('Created admin user:', adminUser)

  // Create email mappings for all admin emails
  for (const email of ADMIN_EMAILS) {
    await docClient.send(new PutCommand({
      TableName: EMAIL_MAPPING_TABLE,
      Item: {
        email: email.toLowerCase(),
        user_id: ADMIN_USER_ID,
        created_at: now,
      },
    }))
    console.log(`Mapped email ${email} -> ${ADMIN_USER_ID}`)
  }

  console.log('\n✅ Admin user seeded successfully!')
  console.log(`   User ID: ${ADMIN_USER_ID}`)
  console.log(`   Emails: ${ADMIN_EMAILS.join(', ')}`)
  console.log(`   Role: admin`)
}

seedAdminUser().catch(console.error)
