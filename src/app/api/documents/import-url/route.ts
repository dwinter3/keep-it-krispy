import { NextRequest, NextResponse } from 'next/server'
import { parseHTML, parseDocument, type DocumentFormat } from '@/lib/documentParser'

/**
 * POST /api/documents/import-url - Fetch and parse content from a URL
 *
 * This endpoint fetches content from a URL, extracts the text,
 * and returns it for the client to save via the main documents API.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { url } = body

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 })
    }

    // Validate URL
    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('Invalid protocol')
      }
    } catch {
      return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 })
    }

    // Check if it's a Google Drive URL
    const isGoogleDrive = parsedUrl.hostname.includes('drive.google.com') ||
                          parsedUrl.hostname.includes('docs.google.com')

    if (isGoogleDrive) {
      return NextResponse.json(
        {
          error: 'Google Drive links require download first',
          message: 'Please download the file from Google Drive and upload it directly. ' +
                   'For Google Docs, use File > Download > Plain Text (.txt) or PDF.',
        },
        { status: 400 }
      )
    }

    // Fetch the URL content
    console.log('Fetching URL:', url)
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; KrispBuddy/1.0; +https://krispy.alpha-pm.dev)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    })

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch URL: ${response.status} ${response.statusText}` },
        { status: 400 }
      )
    }

    const contentType = response.headers.get('content-type') || ''
    const contentLength = response.headers.get('content-length')

    // Check content size (limit to 10MB)
    const maxSize = 10 * 1024 * 1024
    if (contentLength && parseInt(contentLength) > maxSize) {
      return NextResponse.json(
        { error: 'Content too large. Maximum size is 10MB.' },
        { status: 400 }
      )
    }

    // Determine format and parse content
    let content: string
    let title: string | undefined
    let wordCount: number
    let format: DocumentFormat

    if (contentType.includes('application/pdf')) {
      // Fetch as buffer and parse PDF
      const buffer = Buffer.from(await response.arrayBuffer())
      const parsed = await parseDocument(buffer, 'pdf')
      content = parsed.content
      title = parsed.title
      wordCount = parsed.wordCount
      format = 'pdf'
    } else if (contentType.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document')) {
      // Fetch as buffer and parse DOCX
      const buffer = Buffer.from(await response.arrayBuffer())
      const parsed = await parseDocument(buffer, 'docx')
      content = parsed.content
      title = parsed.title
      wordCount = parsed.wordCount
      format = 'docx'
    } else if (contentType.includes('text/plain')) {
      // Plain text
      const text = await response.text()
      const parsed = await parseDocument(text, 'txt')
      content = parsed.content
      title = parsed.title
      wordCount = parsed.wordCount
      format = 'txt'
    } else if (contentType.includes('text/markdown')) {
      // Markdown
      const text = await response.text()
      const parsed = await parseDocument(text, 'md')
      content = parsed.content
      title = parsed.title
      wordCount = parsed.wordCount
      format = 'md'
    } else {
      // Default to HTML parsing
      const html = await response.text()
      const parsed = parseHTML(html)
      content = parsed.content
      title = parsed.title
      wordCount = parsed.wordCount
      format = 'html'
    }

    // Validate content was extracted
    if (!content || content.length < 10) {
      return NextResponse.json(
        { error: 'Could not extract meaningful content from URL' },
        { status: 400 }
      )
    }

    // Use URL hostname + path as fallback title
    if (!title) {
      title = `${parsedUrl.hostname}${parsedUrl.pathname}`.slice(0, 100)
    }

    return NextResponse.json({
      success: true,
      title,
      content,
      format,
      wordCount,
      sourceUrl: url,
    })
  } catch (error) {
    console.error('URL import error:', error)
    return NextResponse.json(
      { error: 'Failed to import URL', details: String(error) },
      { status: 500 }
    )
  }
}
