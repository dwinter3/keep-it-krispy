/**
 * Test script for AI transcript parser
 * Run with: npx tsx scripts/test-ai-parser.ts
 */

import { parseTranscriptWithAI, shouldUseAIParsing } from '../src/lib/parsers/transcript-parser'

// Sample transcripts in various formats

const samples = {
  // Zoom chat export style
  zoomChat: `
10:15:32 From John Smith to Everyone:
Hello everyone, welcome to the meeting

10:15:45 From Sarah Johnson to Everyone:
Thanks John! Excited to be here

10:16:02 From John Smith to Everyone:
Let's start with the quarterly review

10:16:30 From Mike Chen to Everyone:
Sounds good. I have the slides ready
`,

  // Interview style (no timestamps)
  interview: `
Interviewer: Can you tell me about your experience with cloud computing?

Candidate: Of course. I've been working with AWS for the past 5 years, primarily focusing on serverless architectures.

Interviewer: What about Kubernetes?

Candidate: Yes, I've managed production clusters with EKS and also have experience with GKE.

Interviewer: Can you give me an example of a challenging project?

Candidate: Sure. Last year I led the migration of our monolithic application to microservices, which reduced our infrastructure costs by 40%.
`,

  // Raw conversation (minimal formatting)
  rawConversation: `
So I was thinking about the project timeline.
Yeah, we need to discuss that.
The deadline is next Friday, right?
Actually it got moved to the following Monday.
Oh that's better. More time for testing.
Exactly. We should use the extra days wisely.
`,

  // Teams meeting notes style
  teamsMeeting: `
[Recording started]
[10:00 AM] David Winter joined the meeting
[10:01 AM] Lisa Park joined the meeting

David Winter: Good morning Lisa, how are you?

Lisa Park: Good morning! I'm doing well, thanks. Ready to discuss the Q4 roadmap?

David Winter: Yes, let's dive in. I've prepared some slides.

Lisa Park: Great. Can you share your screen?

David Winter: Sure, one moment.
`,

  // Already in Krisp format (should skip AI)
  krispFormat: `
Speaker 1 | 00:00
Hello everyone, welcome to the meeting

Speaker 2 | 00:05
Thanks for having me

Speaker 1 | 00:10
Let's get started with the agenda
`,
}

async function testAIParsing() {
  console.log('='.repeat(60))
  console.log('AI Transcript Parser Test')
  console.log('='.repeat(60))

  for (const [name, content] of Object.entries(samples)) {
    console.log(`\n--- Testing: ${name} ---`)
    console.log(`Should use AI: ${shouldUseAIParsing(content)}`)

    try {
      const result = await parseTranscriptWithAI(content, `${name}.txt`)
      console.log(`Format: ${result.formatDescription}`)
      console.log(`Speakers: ${result.speakers.join(', ')}`)
      console.log(`Duration: ${result.duration}s`)
      console.log(`Confidence: ${result.confidence}%`)
      console.log(`Used AI: ${result.usedAI}`)
      if (result.warnings.length > 0) {
        console.log(`Warnings: ${result.warnings.join('; ')}`)
      }
      console.log(`\nParsed content (first 300 chars):`)
      console.log(result.rawContent.slice(0, 300))
      if (result.rawContent.length > 300) console.log('...')
    } catch (error) {
      console.error(`Error: ${error}`)
    }
  }

  console.log('\n' + '='.repeat(60))
  console.log('Test complete')
  console.log('='.repeat(60))
}

testAIParsing().catch(console.error)
