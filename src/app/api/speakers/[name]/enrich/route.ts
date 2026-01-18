import { NextRequest, NextResponse } from 'next/server'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, ScanCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import { SpeakerContext } from '../context/route'

const TABLE_NAME = process.env.DYNAMODB_TABLE || 'krisp-transcripts-index'
const SPEAKERS_TABLE = process.env.SPEAKERS_TABLE || 'krisp-speakers'
const BUCKET_NAME = process.env.KRISP_S3_BUCKET || ''
const AWS_REGION = process.env.APP_REGION || 'us-east-1'

const credentials = process.env.S3_ACCESS_KEY_ID ? {
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
} : undefined

const dynamoClient = new DynamoDBClient({ region: AWS_REGION, credentials })
const dynamodb = DynamoDBDocumentClient.from(dynamoClient)
const s3 = new S3Client({ region: AWS_REGION, credentials })
const bedrock = new BedrockRuntimeClient({ region: AWS_REGION, credentials })

interface TranscriptItem {
  meeting_id: string
  s3_key: string
  title: string
  date: string
  timestamp: string
  speakers?: string[]
  speaker_corrections?: Record<string, { name: string; linkedin?: string }>
}

interface TranscriptContent {
  raw_payload?: {
    data?: {
      raw_content?: string
      raw_meeting?: string
    }
  }
}

interface WebSearchResult {
  title: string
  url: string
  snippet: string
}

interface EnrichedData {
  title: string
  company: string
  summary: string
  linkedinUrl?: string
  photoUrl?: string
  fullName?: string  // Full name if found (e.g., "Babak Hosseinzadeh" from "Babak")
}

interface ValidationResult {
  confidence: number
  reasoning: string
  redFlags: string[]
}

// Helper function to extract speaker context (replicating context endpoint logic inline)
async function extractSpeakerContext(speakerName: string): Promise<SpeakerContext | null> {
  const speakerNameLower = speakerName.toLowerCase()

  // Find all meetings with this speaker
  const allItems: TranscriptItem[] = []
  let lastKey: Record<string, unknown> | undefined

  do {
    const scanCommand = new ScanCommand({
      TableName: TABLE_NAME,
      ProjectionExpression: 'meeting_id, s3_key, title, #date, #timestamp, speakers, speaker_corrections',
      ExpressionAttributeNames: {
        '#date': 'date',
        '#timestamp': 'timestamp',
      },
      ...(lastKey && { ExclusiveStartKey: lastKey }),
    })

    const response = await dynamodb.send(scanCommand)
    if (response.Items) {
      allItems.push(...(response.Items as TranscriptItem[]))
    }
    lastKey = response.LastEvaluatedKey
  } while (lastKey)

  // Filter meetings with this speaker
  const speakerMeetings: { key: string; title: string; date: string }[] = []
  let canonicalName = speakerName

  for (const item of allItems) {
    const speakers = item.speakers || []
    const corrections = item.speaker_corrections || {}

    for (const speaker of speakers) {
      const speakerLower = speaker.toLowerCase()
      const correction = corrections[speakerLower]
      const correctedName = correction?.name || speaker

      if (speakerLower === speakerNameLower ||
          correctedName.toLowerCase() === speakerNameLower) {
        speakerMeetings.push({
          key: item.s3_key,
          title: item.title || 'Untitled',
          date: item.timestamp || item.date,
        })
        if (correction?.name) {
          canonicalName = correction.name
        }
        break
      }
    }
  }

  if (speakerMeetings.length === 0) {
    return null
  }

  // Sort by date and take most recent meetings
  speakerMeetings.sort((a, b) => b.date.localeCompare(a.date))
  const recentMeetings = speakerMeetings.slice(0, 10)

  // Fetch transcript content
  const transcriptExcerpts: string[] = []
  for (const meeting of recentMeetings.slice(0, 5)) {
    try {
      const getCommand = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: meeting.key,
      })
      const response = await s3.send(getCommand)
      const body = await response.Body?.transformToString()
      if (body) {
        const content: TranscriptContent = JSON.parse(body)
        const transcript = content.raw_payload?.data?.raw_content || ''
        const summary = content.raw_payload?.data?.raw_meeting || ''
        const excerpt = summary || transcript.slice(0, 3000)
        if (excerpt) {
          transcriptExcerpts.push(`Meeting: ${meeting.title}\n${excerpt}`)
        }
      }
    } catch (err) {
      console.error(`Error fetching transcript ${meeting.key}:`, err)
    }
  }

  if (transcriptExcerpts.length === 0) {
    return {
      name: canonicalName,
      contextKeywords: [],
      companies: [],
      topics: [],
      roleHints: [],
      transcriptCount: speakerMeetings.length,
      recentMeetingTitles: recentMeetings.map(m => m.title),
    }
  }

  // Use AI to extract context
  const prompt = `Analyze the following meeting transcripts involving "${canonicalName}" and extract professional context.

Meeting transcripts:
${transcriptExcerpts.join('\n\n---\n\n')}

Extract and return a JSON object with:
1. "contextKeywords": 5-10 unique keywords/terms the speaker frequently uses or is associated with
2. "companies": Any company names mentioned or associated with this speaker
3. "topics": 3-5 main professional topics/areas they discuss
4. "roleHints": Any hints about their job role/title

Return ONLY valid JSON:
{
  "contextKeywords": [],
  "companies": [],
  "topics": [],
  "roleHints": []
}`

  let contextKeywords: string[] = []
  let companies: string[] = []
  let topics: string[] = []
  let roleHints: string[] = []

  try {
    const invokeCommand = new InvokeModelCommand({
      modelId: 'amazon.nova-lite-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        messages: [{ role: 'user', content: [{ text: prompt }] }],
        inferenceConfig: { maxTokens: 1000, temperature: 0.3 },
      }),
    })

    const response = await bedrock.send(invokeCommand)
    const responseBody = JSON.parse(new TextDecoder().decode(response.body))
    const assistantMessage = responseBody.output?.message?.content?.[0]?.text || ''

    try {
      const jsonMatch = assistantMessage.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        contextKeywords = parsed.contextKeywords || []
        companies = parsed.companies || []
        topics = parsed.topics || []
        roleHints = parsed.roleHints || []
      }
    } catch {
      console.error('Failed to parse AI context response')
    }
  } catch (err) {
    console.error('Bedrock context extraction error:', err)
  }

  return {
    name: canonicalName,
    contextKeywords,
    companies,
    topics,
    roleHints,
    transcriptCount: speakerMeetings.length,
    recentMeetingTitles: recentMeetings.map(m => m.title),
  }
}

// Simulate web search using DuckDuckGo HTML scraping (no API key needed)
async function searchWeb(query: string): Promise<WebSearchResult[]> {
  try {
    const encodedQuery = encodeURIComponent(query)
    const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; KrispBuddy/1.0)',
      },
    })

    if (!response.ok) {
      console.error('DuckDuckGo search failed:', response.status)
      return []
    }

    const html = await response.text()
    const results: WebSearchResult[] = []

    // Parse results from HTML using regex (simple extraction)
    const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([^<]*(?:<[^>]*>[^<]*)*)<\/a>/g
    let match

    while ((match = resultRegex.exec(html)) !== null && results.length < 5) {
      const [, encodedUrl, title, snippetHtml] = match
      // Decode DuckDuckGo redirect URL
      const urlMatch = encodedUrl.match(/uddg=([^&]+)/)
      const actualUrl = urlMatch ? decodeURIComponent(urlMatch[1]) : encodedUrl
      // Clean HTML from snippet
      const snippet = snippetHtml.replace(/<[^>]*>/g, '').trim()

      if (title && actualUrl) {
        results.push({
          title: title.trim(),
          url: actualUrl,
          snippet,
        })
      }
    }

    // Fallback: try simpler pattern if no results
    if (results.length === 0) {
      const simpleRegex = /<a[^>]*class="result__a"[^>]*>([^<]*)<\/a>/g
      while ((match = simpleRegex.exec(html)) !== null && results.length < 3) {
        results.push({
          title: match[1].trim(),
          url: '',
          snippet: '',
        })
      }
    }

    return results
  } catch (err) {
    console.error('Web search error:', err)
    return []
  }
}

// Validate web result against speaker context using AI
async function validateWebResult(
  context: SpeakerContext,
  webResult: WebSearchResult,
  humanHints?: string
): Promise<ValidationResult> {
  const hintsSection = humanHints
    ? `\n- HUMAN-PROVIDED HINTS (high priority): ${humanHints}`
    : ''

  const prompt = `Given this context about a speaker from meeting transcripts:
- Name: ${context.name}
- Topics discussed: ${context.topics.join(', ') || 'Unknown'}
- Companies mentioned: ${context.companies.join(', ') || 'Unknown'}
- Role indicators: ${context.roleHints.join(', ') || 'Unknown'}
- Keywords: ${context.contextKeywords.join(', ') || 'Unknown'}${hintsSection}

And this web search result:
- Title: ${webResult.title}
- URL: ${webResult.url}
- Snippet: ${webResult.snippet}

Evaluate:
1. Is this likely the same person? (0-100 confidence score)
2. What evidence supports or contradicts this match?
3. Any red flags? (e.g., completely different industry, wrong location, different career level)

Consider:
- LinkedIn profiles are strong indicators if the name and context match
- Company names matching is a strong positive signal
- Topic/industry alignment increases confidence
- Generic or common names require more corroborating evidence
- HUMAN-PROVIDED HINTS should be weighted heavily - if the hint says "works at X company" and the result shows X company, that's a very strong match

Return ONLY valid JSON:
{
  "confidence": 0,
  "reasoning": "Brief explanation...",
  "redFlags": []
}`

  try {
    const invokeCommand = new InvokeModelCommand({
      modelId: 'amazon.nova-lite-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        messages: [{ role: 'user', content: [{ text: prompt }] }],
        inferenceConfig: { maxTokens: 500, temperature: 0.2 },
      }),
    })

    const response = await bedrock.send(invokeCommand)
    const responseBody = JSON.parse(new TextDecoder().decode(response.body))
    const assistantMessage = responseBody.output?.message?.content?.[0]?.text || ''

    try {
      const jsonMatch = assistantMessage.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        return {
          confidence: Math.min(100, Math.max(0, parsed.confidence || 0)),
          reasoning: parsed.reasoning || '',
          redFlags: parsed.redFlags || [],
        }
      }
    } catch {
      console.error('Failed to parse validation response')
    }
  } catch (err) {
    console.error('Validation error:', err)
  }

  return { confidence: 0, reasoning: 'Unable to validate', redFlags: [] }
}

// Extract enriched data from web results
async function extractEnrichedData(
  context: SpeakerContext,
  validatedResults: Array<{ result: WebSearchResult; validation: ValidationResult }>
): Promise<{ enrichedData: EnrichedData; bestConfidence: number; reasoning: string; sources: string[] }> {
  // Find the best result
  const bestResult = validatedResults.reduce((best, current) =>
    current.validation.confidence > best.validation.confidence ? current : best
  , validatedResults[0])

  if (!bestResult || bestResult.validation.confidence < 30) {
    // Not confident enough, return context-based summary
    return {
      enrichedData: {
        title: context.roleHints.length > 0 ? context.roleHints.join(' / ') : 'Professional',
        company: context.companies.length > 0 ? context.companies[0] : '',
        summary: `Based on meeting conversations, ${context.name} discusses ${context.topics.slice(0, 3).join(', ') || 'various professional topics'}.`,
      },
      bestConfidence: bestResult?.validation.confidence || 0,
      reasoning: bestResult?.validation.reasoning || 'No web results found',
      sources: [],
    }
  }

  // Use AI to extract structured data from the best result
  const prompt = `Extract professional profile information from this web search result about ${context.name}:

Title: ${bestResult.result.title}
URL: ${bestResult.result.url}
Snippet: ${bestResult.result.snippet}

Additional context from meetings:
- Known topics: ${context.topics.join(', ')}
- Known companies: ${context.companies.join(', ')}
- Role hints: ${context.roleHints.join(', ')}

Extract and return a JSON object:
{
  "fullName": "The person's full name if visible (e.g., 'Babak Hosseinzadeh' from a profile showing just 'Babak')",
  "title": "Job title (if identifiable)",
  "company": "Company name (if identifiable)",
  "summary": "2-3 sentence professional summary combining web info and meeting context. Start with the full name.",
  "linkedinUrl": "LinkedIn URL if the result is from LinkedIn, otherwise null"
}

Return ONLY valid JSON.`

  try {
    const invokeCommand = new InvokeModelCommand({
      modelId: 'amazon.nova-lite-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        messages: [{ role: 'user', content: [{ text: prompt }] }],
        inferenceConfig: { maxTokens: 500, temperature: 0.3 },
      }),
    })

    const response = await bedrock.send(invokeCommand)
    const responseBody = JSON.parse(new TextDecoder().decode(response.body))
    const assistantMessage = responseBody.output?.message?.content?.[0]?.text || ''

    try {
      const jsonMatch = assistantMessage.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        return {
          enrichedData: {
            fullName: parsed.fullName || undefined,
            title: parsed.title || '',
            company: parsed.company || '',
            summary: parsed.summary || '',
            linkedinUrl: parsed.linkedinUrl || undefined,
          },
          bestConfidence: bestResult.validation.confidence,
          reasoning: bestResult.validation.reasoning,
          sources: validatedResults
            .filter(r => r.validation.confidence >= 30)
            .map(r => r.result.url)
            .filter(Boolean),
        }
      }
    } catch {
      console.error('Failed to parse enriched data response')
    }
  } catch (err) {
    console.error('Enriched data extraction error:', err)
  }

  // Fallback
  return {
    enrichedData: {
      title: '',
      company: context.companies[0] || '',
      summary: bestResult.result.snippet || '',
      linkedinUrl: bestResult.result.url.includes('linkedin.com') ? bestResult.result.url : undefined,
    },
    bestConfidence: bestResult.validation.confidence,
    reasoning: bestResult.validation.reasoning,
    sources: [bestResult.result.url].filter(Boolean),
  }
}

// POST /api/speakers/[name]/enrich - Enrich speaker profile with web search and AI validation
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params
    const speakerName = decodeURIComponent(name)
    const speakerNameLower = speakerName.toLowerCase()

    // Parse request body for options
    let forceRefresh = false
    let hints = ''
    let excludeUrls: string[] = []
    try {
      const body = await request.json()
      forceRefresh = body.forceRefresh === true
      hints = body.hints || ''
      excludeUrls = body.excludeUrls || []
    } catch {
      // No body or invalid JSON, use defaults
    }

    // Load existing speaker data to get rejected profiles
    let existingRejectedProfiles: string[] = []
    let existingHints = ''
    try {
      const getCommand = new GetCommand({
        TableName: SPEAKERS_TABLE,
        Key: { name: speakerNameLower },
      })
      const existing = await dynamodb.send(getCommand)
      if (existing.Item) {
        existingRejectedProfiles = existing.Item.rejectedProfiles || []
        existingHints = existing.Item.humanHints || ''
      }
    } catch {
      // Continue without existing data
    }

    // Merge excluded URLs with previously rejected profiles
    const allExcludedUrls = [...new Set([...excludeUrls, ...existingRejectedProfiles])]

    // Combine existing hints with new hints
    const combinedHints = [existingHints, hints].filter(Boolean).join('. ')

    // Check for cached enrichment (unless force refresh)
    if (!forceRefresh) {
      try {
        const getCommand = new GetCommand({
          TableName: SPEAKERS_TABLE,
          Key: { name: speakerNameLower },
        })
        const existing = await dynamodb.send(getCommand)
        if (existing.Item?.webEnrichedAt) {
          const enrichedAt = new Date(existing.Item.webEnrichedAt)
          const daysSinceEnrich = (Date.now() - enrichedAt.getTime()) / (1000 * 60 * 60 * 24)
          // Cache web enrichment for 14 days
          if (daysSinceEnrich < 14 && existing.Item.enrichedData) {
            return NextResponse.json({
              cached: true,
              name: existing.Item.displayName || speakerName,
              enrichedData: existing.Item.enrichedData,
              confidence: existing.Item.enrichedConfidence || 0,
              reasoning: existing.Item.enrichedReasoning || '',
              sources: existing.Item.enrichedSources || [],
              enrichedAt: existing.Item.webEnrichedAt,
              aiSummary: existing.Item.aiSummary,
              topics: existing.Item.topics || [],
              humanHints: existing.Item.humanHints || null,
              rejectedProfiles: existing.Item.rejectedProfiles || null,
              humanVerified: existing.Item.humanVerified || false,
              humanVerifiedAt: existing.Item.humanVerifiedAt || null,
            })
          }
        }
      } catch {
        // Table may not exist, continue
      }
    }

    // Step 1: Extract speaker context
    const context = await extractSpeakerContext(speakerName)
    if (!context) {
      return NextResponse.json({
        error: 'No meetings found for this speaker',
      }, { status: 404 })
    }

    // Step 2: Build search query
    const searchTerms = [context.name]

    // Include human-provided hints in search (high priority)
    if (combinedHints) {
      // Extract key terms from hints (company names, locations, titles)
      const hintTerms = combinedHints.split(/[,.]/).map(t => t.trim()).filter(Boolean).slice(0, 3)
      searchTerms.push(...hintTerms)
    }

    // Add context from transcripts
    if (context.companies.length > 0) {
      searchTerms.push(context.companies[0])
    }
    if (context.roleHints.length > 0) {
      searchTerms.push(context.roleHints[0])
    } else if (context.contextKeywords.length > 0) {
      searchTerms.push(context.contextKeywords[0])
    }
    // Add LinkedIn to prioritize profile results
    searchTerms.push('LinkedIn')

    const searchQuery = searchTerms.join(' ')
    console.log('Searching for:', searchQuery)

    // Step 3: Search the web
    let webResults = await searchWeb(searchQuery)
    console.log('Found', webResults.length, 'web results')

    // Filter out previously rejected profiles
    if (allExcludedUrls.length > 0) {
      webResults = webResults.filter(result =>
        !allExcludedUrls.some(excluded => result.url.includes(excluded) || excluded.includes(result.url))
      )
      console.log('After filtering rejected profiles:', webResults.length, 'results remain')
    }

    // Step 4: Validate each result against context
    const validatedResults: Array<{ result: WebSearchResult; validation: ValidationResult }> = []

    for (const result of webResults.slice(0, 3)) {
      const validation = await validateWebResult(context, result, combinedHints)
      validatedResults.push({ result, validation })
    }

    // Step 5: Extract enriched data from best results
    const { enrichedData, bestConfidence, reasoning, sources } =
      validatedResults.length > 0
        ? await extractEnrichedData(context, validatedResults)
        : {
            enrichedData: {
              title: context.roleHints.join(' / ') || '',
              company: context.companies[0] || '',
              summary: `Based on ${context.transcriptCount} meetings, ${context.name} discusses ${context.topics.join(', ') || 'various professional topics'}.`,
            },
            bestConfidence: 0,
            reasoning: 'No web search results available',
            sources: [],
          }

    // Also generate AI summary from transcripts (existing functionality)
    let aiSummary = ''
    const topics = context.topics

    // If we have context, use it for the summary
    if (context.transcriptCount > 0) {
      const summaryPrompt = `Based on ${context.transcriptCount} meeting transcripts with ${context.name}, provide a brief professional summary.

Known context:
- Topics: ${context.topics.join(', ')}
- Companies: ${context.companies.join(', ')}
- Role hints: ${context.roleHints.join(', ')}
- Keywords: ${context.contextKeywords.join(', ')}

Write a 2-3 sentence professional summary focusing on their apparent role and expertise. Be concise and professional.

Return ONLY the summary text, no JSON.`

      try {
        const invokeCommand = new InvokeModelCommand({
          modelId: 'amazon.nova-lite-v1:0',
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            messages: [{ role: 'user', content: [{ text: summaryPrompt }] }],
            inferenceConfig: { maxTokens: 300, temperature: 0.5 },
          }),
        })

        const response = await bedrock.send(invokeCommand)
        const responseBody = JSON.parse(new TextDecoder().decode(response.body))
        aiSummary = responseBody.output?.message?.content?.[0]?.text || ''
      } catch (err) {
        console.error('AI summary generation error:', err)
        aiSummary = `${context.name} has participated in ${context.transcriptCount} meeting${context.transcriptCount !== 1 ? 's' : ''}.`
      }
    }

    // Step 6: Cache the enrichment in DynamoDB
    try {
      const updateCommand = new UpdateCommand({
        TableName: SPEAKERS_TABLE,
        Key: { name: speakerNameLower },
        UpdateExpression: `SET
          #displayName = :displayName,
          #enrichedData = :enrichedData,
          #enrichedConfidence = :enrichedConfidence,
          #enrichedReasoning = :enrichedReasoning,
          #enrichedSources = :enrichedSources,
          #webEnrichedAt = :webEnrichedAt,
          #aiSummary = :aiSummary,
          #topics = :topics,
          #enrichedAt = :enrichedAt,
          #humanHints = :humanHints,
          #rejectedProfiles = :rejectedProfiles`,
        ExpressionAttributeNames: {
          '#displayName': 'displayName',
          '#enrichedData': 'enrichedData',
          '#enrichedConfidence': 'enrichedConfidence',
          '#enrichedReasoning': 'enrichedReasoning',
          '#enrichedSources': 'enrichedSources',
          '#webEnrichedAt': 'webEnrichedAt',
          '#aiSummary': 'aiSummary',
          '#topics': 'topics',
          '#enrichedAt': 'enrichedAt',
          '#humanHints': 'humanHints',
          '#rejectedProfiles': 'rejectedProfiles',
        },
        ExpressionAttributeValues: {
          ':displayName': context.name,
          ':enrichedData': enrichedData,
          ':enrichedConfidence': bestConfidence,
          ':enrichedReasoning': reasoning,
          ':enrichedSources': sources,
          ':webEnrichedAt': new Date().toISOString(),
          ':aiSummary': aiSummary,
          ':topics': topics,
          ':enrichedAt': new Date().toISOString(),
          ':humanHints': combinedHints || null,
          ':rejectedProfiles': allExcludedUrls.length > 0 ? allExcludedUrls : null,
        },
      })
      await dynamodb.send(updateCommand)
    } catch (err) {
      console.error('Error caching enrichment:', err)
    }

    return NextResponse.json({
      cached: false,
      name: context.name,
      enrichedData,
      confidence: bestConfidence,
      reasoning,
      sources,
      enrichedAt: new Date().toISOString(),
      aiSummary,
      topics,
      humanHints: combinedHints || null,
      rejectedProfiles: allExcludedUrls.length > 0 ? allExcludedUrls : null,
      context: {
        transcriptCount: context.transcriptCount,
        companies: context.companies,
        roleHints: context.roleHints,
      },
    })
  } catch (error) {
    console.error('Speaker enrichment error:', error)
    return NextResponse.json(
      { error: 'Failed to enrich speaker profile', details: String(error) },
      { status: 500 }
    )
  }
}
