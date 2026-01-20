/**
 * Force AI parsing on specific transcripts to compare results
 * Run with: npx tsx scripts/test-ai-parser-force.ts
 */

import { parseTranscriptWithAI } from '../src/lib/parsers/transcript-parser'

// Transcripts that rule-based struggled with

const transcripts = {
  // Slack-style conversation export - timestamps were incorrectly detected as speakers
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

  // Podcast with bracket timestamps - timestamps incorrectly detected as speakers
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

  // Medical notes - "Date:" incorrectly detected as speaker
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

  // Raw text without any speaker markers
  'raw-notes.txt': `
Had a great call with the client today. They're interested in the enterprise plan.

Main concerns were around data security and compliance. I explained our SOC 2 certification.

They want to do a pilot with 50 users first. Timeline is Q2.

Next steps: Send over the pilot agreement and schedule a technical deep dive for their IT team.

Follow up scheduled for next Thursday at 2pm.
`,
}

async function runForceAITests() {
  console.log('='.repeat(70))
  console.log('AI Transcript Parser - Forced AI Mode')
  console.log('Comparing rule-based vs AI parsing for tricky formats')
  console.log('='.repeat(70))

  for (const [filename, content] of Object.entries(transcripts)) {
    console.log(`\n${'═'.repeat(70)}`)
    console.log(`File: ${filename}`)
    console.log('═'.repeat(70))

    // First, show rule-based result
    console.log('\n📋 RULE-BASED PARSING:')
    const ruleResult = await parseTranscriptWithAI(content, filename, { forceAI: false })
    console.log(`  Speakers: ${ruleResult.speakers.join(', ')}`)
    console.log(`  Confidence: ${ruleResult.confidence}%`)
    console.log(`  Warnings: ${ruleResult.warnings.join('; ') || 'None'}`)
    console.log(`  Preview:\n    ${ruleResult.rawContent.split('\n').slice(0, 4).join('\n    ')}`)

    // Then show AI result
    console.log('\n🤖 AI PARSING (forced):')
    const aiResult = await parseTranscriptWithAI(content, filename, { forceAI: true })
    console.log(`  Format detected: ${aiResult.formatDescription}`)
    console.log(`  Speakers: ${aiResult.speakers.join(', ')}`)
    console.log(`  Confidence: ${aiResult.confidence}%`)
    console.log(`  Preview:\n    ${aiResult.rawContent.split('\n').slice(0, 4).join('\n    ')}`)

    // Compare
    const improvement = (aiResult.confidence || 0) - (ruleResult.confidence || 0)
    const speakerImprovement = aiResult.speakers.length !== ruleResult.speakers.length ||
      aiResult.speakers.some((s, i) => s !== ruleResult.speakers[i])

    console.log('\n📊 COMPARISON:')
    console.log(`  Confidence change: ${improvement >= 0 ? '+' : ''}${improvement}%`)
    console.log(`  Speaker detection: ${speakerImprovement ? '✓ AI found different/better speakers' : '= Same speakers'}`)
    console.log(`  AI better: ${improvement > 0 || speakerImprovement ? 'YES' : 'NO'}`)
  }

  console.log('\n' + '='.repeat(70))
  console.log('Test complete')
  console.log('='.repeat(70))
}

runForceAITests().catch(console.error)
