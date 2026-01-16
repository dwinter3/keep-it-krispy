'use client'

import { useState, useEffect } from 'react'
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
  count: number
  enrichedSpeakers: number
  topics: Topic[]
}

export default function TopicsPage() {
  const [topics, setTopics] = useState<Topic[]>([])
  const [enrichedSpeakers, setEnrichedSpeakers] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchTopics() {
      try {
        const response = await fetch('/api/topics')
        if (!response.ok) {
          throw new Error(`Failed to fetch topics: ${response.status}`)
        }
        const data: TopicsResponse = await response.json()
        setTopics(data.topics)
        setEnrichedSpeakers(data.enrichedSpeakers)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }

    fetchTopics()
  }, [])

  return (
    <Shell>
      <div className="max-w-4xl">
        <h1 className="text-3xl font-bold mb-2">Topics</h1>
        <p className="text-zinc-400 mb-8">Discover what your contacts are talking about</p>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
            <span className="ml-3 text-zinc-400">Loading topics...</span>
          </div>
        )}

        {error && (
          <div className="bg-red-900/20 border border-red-800 rounded-xl p-4 text-red-400">
            <p className="font-medium">Error loading topics</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        )}

        {!loading && !error && topics.length === 0 && (
          <div className="text-center py-12 text-zinc-500">
            <p>No topics found yet.</p>
            <p className="text-sm mt-2">
              Topics are generated when you enrich speaker profiles with AI insights.
            </p>
            <Link
              href="/speakers"
              className="inline-block mt-4 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors"
            >
              Go to Speakers
            </Link>
          </div>
        )}

        {!loading && !error && topics.length > 0 && (
          <>
            <div className="flex items-center justify-between mb-6">
              <p className="text-sm text-zinc-500">
                {topics.length} topics from {enrichedSpeakers} enriched speakers
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              {topics.map((topic) => (
                <TopicCard key={topic.topic} topic={topic} />
              ))}
            </div>
          </>
        )}
      </div>
    </Shell>
  )
}

function TopicCard({ topic }: { topic: Topic }) {
  // Generate a consistent color based on the topic name
  const colors = [
    'bg-purple-500/20 text-purple-400 border-purple-500/30 hover:border-purple-400/50',
    'bg-blue-500/20 text-blue-400 border-blue-500/30 hover:border-blue-400/50',
    'bg-green-500/20 text-green-400 border-green-500/30 hover:border-green-400/50',
    'bg-yellow-500/20 text-yellow-400 border-yellow-500/30 hover:border-yellow-400/50',
    'bg-pink-500/20 text-pink-400 border-pink-500/30 hover:border-pink-400/50',
    'bg-cyan-500/20 text-cyan-400 border-cyan-500/30 hover:border-cyan-400/50',
    'bg-orange-500/20 text-orange-400 border-orange-500/30 hover:border-orange-400/50',
    'bg-indigo-500/20 text-indigo-400 border-indigo-500/30 hover:border-indigo-400/50',
  ]

  // Simple hash function for consistent color selection
  const hash = topic.topic.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  const colorClass = colors[hash % colors.length]

  return (
    <Link
      href={`/topics/${encodeURIComponent(topic.topic)}`}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${colorClass}`}
    >
      <span className="font-medium">{topic.topic}</span>
      <span className="text-xs opacity-75">
        {topic.speakerCount} speaker{topic.speakerCount !== 1 ? 's' : ''}
      </span>
    </Link>
  )
}
