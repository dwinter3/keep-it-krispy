import { NextRequest, NextResponse } from 'next/server'
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3'

const BUCKET_NAME = process.env.KRISP_S3_BUCKET || 'krisp-transcripts-dwinter'
const AWS_REGION = process.env.AWS_REGION || 'us-east-1'

// S3 client - use custom env vars for Amplify (AWS_ prefix is reserved)
const s3 = new S3Client({
  region: AWS_REGION,
  credentials: process.env.S3_ACCESS_KEY_ID ? {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
  } : undefined,
})

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const key = searchParams.get('key')

  try {
    // If key provided, fetch specific transcript
    if (key) {
      const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      })
      const response = await s3.send(command)
      const body = await response.Body?.transformToString()

      if (!body) {
        return NextResponse.json({ error: 'Empty response' }, { status: 404 })
      }

      return NextResponse.json(JSON.parse(body))
    }

    // Otherwise, list all transcripts
    const command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: 'meetings/',
    })

    const response = await s3.send(command)
    const objects = response.Contents || []

    // Parse transcript metadata from S3 keys
    const transcripts = objects
      .filter(obj => obj.Key?.endsWith('.json'))
      .map(obj => {
        const key = obj.Key || ''
        // Key format: meetings/YYYY/MM/DD/YYYYMMDD_HHMMSS_title_meetingId.json
        const parts = key.split('/')
        const filename = parts[parts.length - 1]
        const dateMatch = filename.match(/^(\d{8})_(\d{6})_(.+)_([^_]+)\.json$/)

        let date = obj.LastModified?.toISOString() || ''
        let title = filename.replace('.json', '')
        let meetingId = ''

        if (dateMatch) {
          const [, dateStr, timeStr, titlePart, id] = dateMatch
          // Format date nicely
          const year = dateStr.slice(0, 4)
          const month = dateStr.slice(4, 6)
          const day = dateStr.slice(6, 8)
          date = `${year}-${month}-${day}`
          title = titlePart.replace(/_/g, ' ')
          meetingId = id
        }

        return {
          key,
          title,
          date,
          meetingId,
          size: obj.Size || 0,
          lastModified: obj.LastModified?.toISOString(),
        }
      })
      .sort((a, b) => (b.lastModified || '').localeCompare(a.lastModified || ''))

    return NextResponse.json({ transcripts })
  } catch (error) {
    console.error('S3 error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch transcripts', details: String(error) },
      { status: 500 }
    )
  }
}
