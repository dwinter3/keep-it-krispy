'use client'

import { useState, useEffect, use } from 'react'
import Link from 'next/link'
import Shell from '@/components/Shell'

interface TopicSpeaker {
  name: string
  displayName: string
}

interface Topic {
  topic: string
  speakerCount: number
  speakers: TopicSpeaker[]
}

interface TopicsResponse {
  topics: Topic[]
}

export default function TopicDetailPage({ params }: { params: Promise<{ topic: string }> }) {
  const { topic: encodedTopic } = use(params)
  const topic = decodeURIComponent(encodedTopic)
  const [topicData, setTopicData] = useState<Topic | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchTopicData() {
      try {
        const response = await fetch('/api/topics')
        if (!response.ok) {
          throw new Error(`Failed to fetch topics: ${response.status}`)
        }
        const data: TopicsResponse = await response.json()

        // Find the specific topic (case-insensitive match)
        const found = data.topics.find(
          (t) => t.topic.toLowerCase() === topic.toLowerCase()
        )

        if (!found) {
          throw new Error('Topic not found')
        }

        setTopicData(found)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }

    fetchTopicData()
  }, [topic])

  // Generate initials for speaker avatar
  function getInitials(name: string): string {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase()
  }

  return (
    <Shell>
      <div className="max-w-4xl">
        {/* Back link */}
        <Link
          href="/topics"
          className="inline-flex items-center gap-2 text-zinc-400 hover:text-white mb-6 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Topics
        </Link>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
            <span className="ml-3 text-zinc-400">Loading topic...</span>
          </div>
        )}

        {error && (
          <div className="bg-red-900/20 border border-red-800 rounded-xl p-4 text-red-400">
            <p className="font-medium">Error loading topic</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        )}

        {!loading && !error && topicData && (
          <>
            {/* Topic Header */}
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 mb-6">
              <div className="flex items-center gap-3 mb-2">
                <span className="px-3 py-1 bg-purple-500/20 text-purple-400 rounded-lg text-lg font-medium">
                  {topicData.topic}
                </span>
              </div>
              <p className="text-zinc-400 mt-3">
                {topicData.speakerCount} speaker{topicData.speakerCount !== 1 ? 's' : ''} discuss this topic
              </p>
            </div>

            {/* Speakers List */}
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-800">
                <h2 className="font-semibold">Speakers discussing {topicData.topic}</h2>
              </div>

              <div className="divide-y divide-zinc-800">
                {topicData.speakers.map((speaker) => (
                  <Link
                    key={speaker.name}
                    href={`/speakers/${encodeURIComponent(speaker.name)}`}
                    className="flex items-center gap-4 px-4 py-4 hover:bg-zinc-800/50 transition-colors"
                  >
                    {/* Avatar */}
                    <div className="w-10 h-10 bg-zinc-800 rounded-full flex items-center justify-center text-sm font-medium flex-shrink-0">
                      {getInitials(speaker.displayName)}
                    </div>

                    {/* Name */}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium truncate">{speaker.displayName}</h3>
                    </div>

                    {/* Arrow */}
                    <svg className="w-5 h-5 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </Shell>
  )
}
