/**
 * AI-Powered Transcript Parser
 *
 * Uses Amazon Bedrock (Nova Lite) as a fallback when rule-based parsing
 * can't confidently parse a transcript format. The AI can interpret
 * various transcript formats and convert them to the standard Krisp format.
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime'

const bedrock = new BedrockRuntimeClient({
  region: process.env.APP_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
  },
})

export interface AIParserResult {
  /** Detected transcript format description */
  formatDescription: string
  /** Extracted speakers */
  speakers: string[]
  /** Estimated duration in seconds */
  duration: number
  /** Converted content in Krisp format */
  rawContent: string
  /** AI confidence in the parse (0-100) */
  confidence: number
  /** Any notes or warnings from the AI */
  notes: string[]
}

/**
 * Check if content should use AI parsing
 * Returns true if the content seems like a transcript but doesn't match known patterns
 */
export function shouldUseAIParsing(content: string): boolean {
  const lines = content.split(/\r?\n/).filter(l => l.trim())

  // Too short for meaningful transcript
  if (lines.length < 3) return false

  // Already in Krisp format
  const krispPattern = /^.+?\s*\|\s*\d+:\d+/
  const krispLines = lines.filter(l => krispPattern.test(l))
  if (krispLines.length > lines.length * 0.1) return false

  // Check for transcript-like patterns
  const hasDialogue = lines.some(l =>
    // Common speaker indicators
    /^[A-Z][a-z]+\s*[:\[\(]/.test(l) ||
    /^Speaker\s*\d/i.test(l) ||
    /^[A-Z]{2,}:/.test(l) ||
    // Timestamps
    /\d{1,2}:\d{2}/.test(l) ||
    // Quoted speech
    /"[^"]{10,}"/.test(l)
  )

  // Has reasonable length for a transcript
  const totalLength = content.length
  const avgLineLength = totalLength / lines.length
  const looksLikeTranscript = avgLineLength > 20 && avgLineLength < 500

  return hasDialogue || looksLikeTranscript
}

/**
 * Use AI to intelligently parse a transcript into Krisp format
 */
export async function parseWithAI(
  content: string,
  filename: string
): Promise<AIParserResult> {
  // Truncate content if too long (Nova Lite context limit)
  const maxContentLength = 30000
  const truncatedContent = content.length > maxContentLength
    ? content.slice(0, maxContentLength) + '\n\n[... content truncated ...]'
    : content

  const prompt = `You are a transcript parsing expert. Analyze this transcript and convert it to a standardized format.

INPUT TRANSCRIPT (from file: ${filename}):
---
${truncatedContent}
---

YOUR TASK:
1. Identify the transcript format (e.g., "Zoom chat export", "Teams VTT", "Interview notes", "Raw conversation", etc.)
2. Extract all speaker names/identifiers
3. Convert the content to this exact format:

Speaker Name | MM:SS
Spoken text here

Speaker Name | MM:SS
Next spoken text

RULES:
- Each utterance starts with "Speaker Name | MM:SS" on its own line
- The spoken text follows on the next line
- Blank line between utterances
- If timestamps exist, convert to MM:SS format
- If no timestamps, estimate based on ~150 words/minute
- Preserve speaker names as written (e.g., "David Winter", "Speaker 1", "Interviewer")
- Do NOT include timestamps in the spoken text
- Merge very short consecutive utterances from the same speaker

Respond in this exact JSON format:
{
  "formatDescription": "Brief description of the detected format",
  "speakers": ["Speaker Name 1", "Speaker Name 2"],
  "estimatedDurationSeconds": 300,
  "confidence": 85,
  "notes": ["Any issues or warnings"],
  "convertedTranscript": "Speaker 1 | 00:00\\nHello everyone\\n\\nSpeaker 2 | 00:05\\nHi there"
}

IMPORTANT:
- The convertedTranscript must use \\n for newlines in the JSON string
- confidence should be 0-100 (how confident you are in the parsing)
- If the content isn't a transcript at all, set confidence to 0`

  try {
    const response = await bedrock.send(
      new InvokeModelCommand({
        modelId: 'amazon.nova-lite-v1:0',
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          inferenceConfig: {
            max_new_tokens: 16000,
            temperature: 0.1,
          },
          messages: [
            {
              role: 'user',
              content: [{ text: prompt }],
            },
          ],
        }),
      })
    )

    const responseBody = JSON.parse(new TextDecoder().decode(response.body))
    const aiText = responseBody.output?.message?.content?.[0]?.text || ''

    // Extract JSON from response (AI might include markdown code blocks)
    let jsonStr = aiText
    const jsonMatch = aiText.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (jsonMatch) {
      jsonStr = jsonMatch[1]
    } else {
      // Try to find JSON object directly
      const jsonObjMatch = aiText.match(/\{[\s\S]*\}/)
      if (jsonObjMatch) {
        jsonStr = jsonObjMatch[0]
      }
    }

    const parsed = JSON.parse(jsonStr)

    return {
      formatDescription: parsed.formatDescription || 'Unknown format',
      speakers: parsed.speakers || ['Speaker 1'],
      duration: parsed.estimatedDurationSeconds || 0,
      rawContent: (parsed.convertedTranscript || '').replace(/\\n/g, '\n'),
      confidence: Math.min(100, Math.max(0, parsed.confidence || 0)),
      notes: parsed.notes || [],
    }
  } catch (error) {
    console.error('AI parsing error:', error)

    // Return a basic fallback
    return {
      formatDescription: 'Parse failed',
      speakers: ['Speaker 1'],
      duration: 0,
      rawContent: `Speaker 1 | 00:00\n${content.trim().replace(/\n\s*\n/g, '\n\nSpeaker 1 | 00:00\n')}`,
      confidence: 10,
      notes: [`AI parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
    }
  }
}

/**
 * Parse transcript with AI fallback
 * First tries rule-based parsing, falls back to AI if confidence is low
 */
export async function parseTranscriptWithAIFallback(
  content: string,
  filename: string,
  ruleBasedResult?: {
    speakers: string[]
    duration: number
    rawContent: string
    warnings: string[]
  }
): Promise<AIParserResult & { usedAI: boolean }> {
  // Calculate confidence for rule-based result
  let ruleBasedConfidence = 100

  if (ruleBasedResult) {
    const warnings = ruleBasedResult.warnings

    // Reduce confidence based on warnings
    if (warnings.some(w => w.includes('No speaker format detected'))) {
      ruleBasedConfidence -= 40
    }
    if (warnings.some(w => w.includes('estimated'))) {
      ruleBasedConfidence -= 20
    }
    if (ruleBasedResult.speakers.length === 1 && ruleBasedResult.speakers[0] === 'Speaker 1') {
      ruleBasedConfidence -= 20
    }
    if (ruleBasedResult.rawContent.length < 100) {
      ruleBasedConfidence -= 30
    }

    // If rule-based is confident enough, return it
    if (ruleBasedConfidence >= 70) {
      return {
        formatDescription: 'Standard format (rule-based)',
        speakers: ruleBasedResult.speakers,
        duration: ruleBasedResult.duration,
        rawContent: ruleBasedResult.rawContent,
        confidence: ruleBasedConfidence,
        notes: ruleBasedResult.warnings,
        usedAI: false,
      }
    }
  }

  // Use AI parsing
  if (shouldUseAIParsing(content)) {
    const aiResult = await parseWithAI(content, filename)

    // Only use AI result if it's better than rule-based
    if (ruleBasedResult && aiResult.confidence < ruleBasedConfidence) {
      return {
        formatDescription: 'Standard format (rule-based preferred)',
        speakers: ruleBasedResult.speakers,
        duration: ruleBasedResult.duration,
        rawContent: ruleBasedResult.rawContent,
        confidence: ruleBasedConfidence,
        notes: ruleBasedResult.warnings,
        usedAI: false,
      }
    }

    return {
      ...aiResult,
      usedAI: true,
    }
  }

  // Neither worked well - return rule-based result with low confidence
  if (ruleBasedResult) {
    return {
      formatDescription: 'Unknown format (low confidence)',
      speakers: ruleBasedResult.speakers,
      duration: ruleBasedResult.duration,
      rawContent: ruleBasedResult.rawContent,
      confidence: Math.max(10, ruleBasedConfidence),
      notes: [...ruleBasedResult.warnings, 'Content may not be a valid transcript'],
      usedAI: false,
    }
  }

  // Last resort fallback
  return {
    formatDescription: 'Unparseable content',
    speakers: ['Speaker 1'],
    duration: 0,
    rawContent: `Speaker 1 | 00:00\n${content.trim()}`,
    confidence: 5,
    notes: ['Could not parse transcript - content may not be a valid transcript format'],
    usedAI: false,
  }
}
