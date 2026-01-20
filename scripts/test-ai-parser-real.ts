/**
 * Real-world test for AI transcript parser
 * Run with: npx tsx --env-file=.env.local scripts/test-ai-parser-real.ts
 */

import { parseTranscriptWithAI } from '../src/lib/parsers/transcript-parser'

// Realistic transcript samples

const transcripts = {
  // Zoom webinar chat export
  'zoom-webinar.txt': `
09:00:15 From Host (Sarah Chen) to Everyone:
Welcome everyone to the Q1 Product Launch webinar! We'll start in 5 minutes.

09:05:02 From Host (Sarah Chen) to Everyone:
Alright, let's get started. I'm Sarah Chen, VP of Product.

09:05:30 From Attendee (Michael Brown) to Everyone:
Excited to see what's new!

09:05:45 From Host (Sarah Chen) to Everyone:
Today we're announcing three major features. First up: AI-powered search.

09:06:20 From Co-presenter (James Wilson) to Everyone:
Thanks Sarah. I'll walk you through the technical details.

09:07:00 From Attendee (Lisa Park) to Everyone:
Will this work with existing integrations?

09:07:15 From Co-presenter (James Wilson) to Everyone:
Great question Lisa! Yes, it's fully backwards compatible.

09:08:30 From Attendee (David Lee) to Everyone:
What about pricing?

09:08:45 From Host (Sarah Chen) to Everyone:
We'll cover pricing at the end, David. Stay tuned!
`,

  // Phone call transcript (no timestamps)
  'sales-call.txt': `
Rep: Hi, this is Marcus from Acme Solutions. Am I speaking with Jennifer?

Customer: Yes, this is Jennifer. What can I do for you?

Rep: Jennifer, I noticed you downloaded our whitepaper on cloud migration last week. I wanted to follow up and see if you had any questions.

Customer: Actually yes, I've been looking at options for our team. We're a mid-size company with about 200 employees.

Rep: That's great! What's your current infrastructure looking like?

Customer: We're mostly on-prem right now, using VMware. But we're finding it hard to scale.

Rep: I hear that a lot. Many of our customers in similar situations have seen 40% cost savings after migration. Would you be interested in a demo?

Customer: Sure, that sounds helpful. When are you available?

Rep: I have openings Thursday at 2pm or Friday at 10am. Which works better?

Customer: Let's do Thursday at 2.

Rep: Perfect! I'll send over a calendar invite. Thanks Jennifer!
`,

  // Medical consultation notes
  'doctor-notes.txt': `
Patient Visit - Dr. Amanda Roberts
Date: January 15, 2025
Patient: John Smith (DOB: 03/15/1980)

Dr. Roberts: Good morning John. How are you feeling today?

Patient: Not great, doctor. I've been having headaches for the past week.

Dr. Roberts: I see. Can you describe the headaches? Where exactly do you feel them?

Patient: Mostly behind my eyes and in my temples. It's a throbbing pain.

Dr. Roberts: On a scale of 1 to 10, how would you rate the pain?

Patient: About a 6 or 7. It's worse in the mornings.

Dr. Roberts: Are you experiencing any other symptoms? Nausea, sensitivity to light?

Patient: Yes, actually. Bright lights do bother me when I have the headache.

Dr. Roberts: Based on what you're describing, this sounds like it could be tension headaches or possibly migraines. Let's do some tests to rule out anything else.
`,

  // Slack-style conversation export
  'slack-export.txt': `
#engineering-team

[2025-01-20 10:30:22] alex.kim: Hey team, the build is failing on main. Anyone know what's going on?

[2025-01-20 10:31:05] rachel.torres: Yeah I saw that. Looks like the new dependency broke something.

[2025-01-20 10:31:45] alex.kim: @rachel.torres which dependency?

[2025-01-20 10:32:10] rachel.torres: The axios upgrade to v2. It has breaking changes.

[2025-01-20 10:33:00] sam.patel: I can take a look. Give me 10 mins.

[2025-01-20 10:45:30] sam.patel: Found it. The response.data structure changed. Pushing a fix now.

[2025-01-20 10:46:15] alex.kim: You're a lifesaver Sam! 🙏

[2025-01-20 10:50:00] sam.patel: Build is green again ✅
`,

  // Podcast transcript with timestamps
  'podcast-episode.txt': `
[00:00:00] HOST: Welcome back to Tech Talk Weekly. I'm your host, Emma Davis.

[00:00:05] HOST: Today we have a special guest, CEO of StartupXYZ, Robert Chang.

[00:00:12] GUEST: Thanks for having me, Emma. Great to be here.

[00:00:16] HOST: So Robert, tell us about StartupXYZ. What problem are you solving?

[00:00:22] GUEST: Well, we're tackling the challenge of developer productivity. Most engineers spend 30% of their time on repetitive tasks.

[00:00:35] HOST: That's a significant amount. How does your product help?

[00:00:40] GUEST: We use AI to automate code reviews, generate boilerplate, and suggest optimizations. Our users report saving 10 hours per week.

[00:00:55] HOST: Impressive numbers. What's the technology behind it?

[00:01:02] GUEST: We've built a custom language model trained specifically on code. It understands context better than general-purpose models.

[00:01:15] HOST: And what's next for StartupXYZ?

[00:01:18] GUEST: We're launching enterprise features next quarter and expanding to support more languages.
`,

  // Meeting minutes format
  'board-meeting.txt': `
BOARD MEETING MINUTES
Company: TechCorp Inc.
Date: January 18, 2025
Attendees: CEO John Martinez, CFO Susan Lee, CTO David Park, Board Members: Alice Wong, Robert Kim, Maria Garcia

JOHN MARTINEZ: I call this meeting to order. Let's start with the financial update. Susan?

SUSAN LEE: Thank you John. Q4 revenue came in at $45 million, up 23% year-over-year. We're on track for our annual target.

ALICE WONG: That's excellent. What's driving the growth?

SUSAN LEE: Primarily our enterprise segment. We signed 15 new Fortune 500 customers.

ROBERT KIM: What about the international expansion we discussed last quarter?

DAVID PARK: We've launched in three new markets - UK, Germany, and Japan. Early results are promising.

MARIA GARCIA: Any concerns we should be aware of?

JOHN MARTINEZ: Competition is heating up. We need to accelerate our product roadmap.

DAVID PARK: Agreed. I'm proposing we double our engineering team this year.

ALICE WONG: What's the budget impact?

SUSAN LEE: We'd need an additional $8 million in headcount costs, but the ROI projections support it.

JOHN MARTINEZ: Let's vote on the proposal. All in favor?

[VOTE: Approved unanimously]
`,

  // Random foreign language mix (should still work)
  'multilingual-call.txt': `
Carlos: Hola Maria, ¿cómo estás?

Maria: Muy bien, gracias Carlos. Ready for the meeting?

Carlos: Yes, let me switch to English for the team.

Maria: Good idea. So, about the Latin America expansion...

Carlos: We've identified three key markets: Mexico, Brazil, and Argentina.

Maria: Brazil is interesting but they speak Portuguese, not Spanish.

Carlos: True, but our product already supports multiple languages. We can handle it.

Maria: What's the timeline looking like?

Carlos: Q2 for Mexico, Q3 for Brazil, Q4 for Argentina. Gradual rollout.

Maria: Sounds like a solid plan. Let's present this to leadership.
`,
}

async function runTests() {
  console.log('='.repeat(70))
  console.log('AI Transcript Parser - Real World Tests')
  console.log('='.repeat(70))
  console.log(`AWS Region: ${process.env.APP_REGION}`)
  console.log(`Credentials configured: ${process.env.S3_ACCESS_KEY_ID ? 'Yes' : 'No'}`)
  console.log('='.repeat(70))

  const results: Array<{
    name: string
    success: boolean
    usedAI: boolean
    confidence: number
    speakers: string[]
    duration: number
    format: string
  }> = []

  for (const [filename, content] of Object.entries(transcripts)) {
    console.log(`\n${'─'.repeat(70)}`)
    console.log(`Testing: ${filename}`)
    console.log('─'.repeat(70))

    try {
      const startTime = Date.now()
      const result = await parseTranscriptWithAI(content, filename)
      const elapsed = Date.now() - startTime

      results.push({
        name: filename,
        success: true,
        usedAI: result.usedAI || false,
        confidence: result.confidence || 0,
        speakers: result.speakers,
        duration: result.duration,
        format: result.formatDescription || result.format,
      })

      console.log(`✓ Parsed in ${elapsed}ms`)
      console.log(`  Format: ${result.formatDescription || result.format}`)
      console.log(`  Used AI: ${result.usedAI ? 'Yes' : 'No'}`)
      console.log(`  Confidence: ${result.confidence}%`)
      console.log(`  Speakers (${result.speakers.length}): ${result.speakers.join(', ')}`)
      console.log(`  Duration: ${result.duration}s`)

      if (result.warnings.length > 0) {
        console.log(`  Warnings: ${result.warnings.join('; ')}`)
      }

      // Show first few lines of parsed content
      const previewLines = result.rawContent.split('\n').slice(0, 8)
      console.log(`\n  Preview:`)
      previewLines.forEach(line => console.log(`    ${line}`))
      if (result.rawContent.split('\n').length > 8) {
        console.log(`    ...`)
      }

    } catch (error) {
      results.push({
        name: filename,
        success: false,
        usedAI: false,
        confidence: 0,
        speakers: [],
        duration: 0,
        format: 'error',
      })
      console.log(`✗ Error: ${error instanceof Error ? error.message : error}`)
    }
  }

  // Summary
  console.log(`\n${'='.repeat(70)}`)
  console.log('SUMMARY')
  console.log('='.repeat(70))

  console.log('\n| File | AI Used | Confidence | Speakers | Duration |')
  console.log('|------|---------|------------|----------|----------|')

  for (const r of results) {
    const aiFlag = r.usedAI ? '✓ AI' : 'Rule'
    const confStr = `${r.confidence}%`
    const speakersStr = r.speakers.length.toString()
    const durStr = `${r.duration}s`
    console.log(`| ${r.name.padEnd(20)} | ${aiFlag.padEnd(7)} | ${confStr.padEnd(10)} | ${speakersStr.padEnd(8)} | ${durStr.padEnd(8)} |`)
  }

  const aiUsed = results.filter(r => r.usedAI).length
  const avgConfidence = results.reduce((sum, r) => sum + r.confidence, 0) / results.length

  console.log(`\nTotal: ${results.length} transcripts`)
  console.log(`AI parsing used: ${aiUsed}/${results.length}`)
  console.log(`Average confidence: ${avgConfidence.toFixed(1)}%`)
  console.log('='.repeat(70))
}

runTests().catch(console.error)
