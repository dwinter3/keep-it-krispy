'use client'

import { useEffect, useState, useCallback } from 'react'
import Shell from '@/components/Shell'

interface ActionItem {
  text: string
  meeting: string
}

interface CrossReference {
  topic: string
  meetings: string[]
}

interface MeetingSummary {
  title: string
  summary: string
}

interface BriefingSummary {
  meeting_count: number
  key_themes: string[]
  action_items: ActionItem[]
  cross_references: CrossReference[]
  meeting_summaries: MeetingSummary[]
}

interface Briefing {
  briefing_id: string
  user_id: string
  date: string
  generated_at: string
  summary: BriefingSummary
}

export default function BriefingsPage() {
  const [briefings, setBriefings] = useState<Briefing[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedBriefing, setSelectedBriefing] = useState<Briefing | null>(null)
  const [generating, setGenerating] = useState(false)
  const [generateDate, setGenerateDate] = useState<string>(() => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    return yesterday.toISOString().split('T')[0]
  })

  const fetchBriefings = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/briefings?limit=30')
      if (!res.ok) throw new Error('Failed to fetch briefings')
      const data = await res.json()
      setBriefings(data.briefings || [])

      // Auto-select the most recent briefing
      if (data.briefings?.length > 0 && !selectedBriefing) {
        setSelectedBriefing(data.briefings[0])
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [selectedBriefing])

  useEffect(() => {
    fetchBriefings()
  }, [fetchBriefings])

  const generateBriefing = async (forceRegenerate = false) => {
    try {
      setGenerating(true)
      setError(null)

      const res = await fetch('/api/briefings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: generateDate, forceRegenerate }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to generate briefing')
      }

      const data = await res.json()

      if (data.briefing) {
        setSelectedBriefing(data.briefing)

        // Refresh the list
        await fetchBriefings()
      } else {
        setError(data.message || 'No transcripts found for this date')
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setGenerating(false)
    }
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  return (
    <Shell>
      <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Morning Briefings</h1>
          <p className="mt-1 text-sm text-gray-500">
            AI-generated summaries of your daily meetings
          </p>
        </div>

        {/* Generate Briefing Section */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Generate Briefing</h2>
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end">
            <div className="flex-1">
              <label htmlFor="date" className="block text-sm font-medium text-gray-700 mb-1">
                Select Date
              </label>
              <input
                type="date"
                id="date"
                value={generateDate}
                onChange={(e) => setGenerateDate(e.target.value)}
                max={new Date().toISOString().split('T')[0]}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              />
            </div>
            <button
              onClick={() => generateBriefing(false)}
              disabled={generating}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generating ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Generating...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Generate Now
                </>
              )}
            </button>
          </div>
          {error && (
            <p className="mt-3 text-sm text-red-600">{error}</p>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Briefings List */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="p-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Past Briefings</h2>
              </div>
              <div className="divide-y divide-gray-200 max-h-[600px] overflow-y-auto">
                {loading ? (
                  <div className="p-8 text-center">
                    <svg className="animate-spin h-8 w-8 text-gray-400 mx-auto" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <p className="mt-2 text-sm text-gray-500">Loading briefings...</p>
                  </div>
                ) : briefings.length === 0 ? (
                  <div className="p-8 text-center">
                    <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <h3 className="mt-2 text-sm font-medium text-gray-900">No briefings yet</h3>
                    <p className="mt-1 text-sm text-gray-500">
                      Generate your first briefing to get started.
                    </p>
                  </div>
                ) : (
                  briefings.map((briefing) => (
                    <button
                      key={briefing.briefing_id}
                      onClick={() => setSelectedBriefing(briefing)}
                      className={`w-full p-4 text-left hover:bg-gray-50 transition-colors ${
                        selectedBriefing?.briefing_id === briefing.briefing_id
                          ? 'bg-blue-50 border-l-4 border-blue-500'
                          : ''
                      }`}
                    >
                      <p className="font-medium text-gray-900">
                        {formatDate(briefing.date)}
                      </p>
                      <p className="text-sm text-gray-500 mt-1">
                        {briefing.summary.meeting_count} meeting{briefing.summary.meeting_count !== 1 ? 's' : ''}
                        {' | '}
                        {briefing.summary.action_items.length} action item{briefing.summary.action_items.length !== 1 ? 's' : ''}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        Generated {formatTime(briefing.generated_at)}
                      </p>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Briefing Content */}
          <div className="lg:col-span-2">
            {selectedBriefing ? (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                {/* Briefing Header */}
                <div className="p-6 border-b border-gray-200">
                  <div className="flex justify-between items-start">
                    <div>
                      <h2 className="text-xl font-bold text-gray-900">
                        {formatDate(selectedBriefing.date)}
                      </h2>
                      <p className="text-sm text-gray-500 mt-1">
                        {selectedBriefing.summary.meeting_count} meeting{selectedBriefing.summary.meeting_count !== 1 ? 's' : ''} summarized
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setGenerateDate(selectedBriefing.date)
                        generateBriefing(true)
                      }}
                      disabled={generating}
                      className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                    >
                      <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Regenerate
                    </button>
                  </div>
                </div>

                <div className="p-6 space-y-8">
                  {/* Key Themes */}
                  {selectedBriefing.summary.key_themes.length > 0 && (
                    <section>
                      <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
                        <svg className="w-5 h-5 mr-2 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                        </svg>
                        Key Themes
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {selectedBriefing.summary.key_themes.map((theme, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800"
                          >
                            {theme}
                          </span>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Action Items */}
                  {selectedBriefing.summary.action_items.length > 0 && (
                    <section>
                      <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
                        <svg className="w-5 h-5 mr-2 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                        </svg>
                        Action Items
                      </h3>
                      <ul className="space-y-3">
                        {selectedBriefing.summary.action_items.map((item, i) => (
                          <li key={i} className="flex items-start">
                            <span className="flex-shrink-0 w-5 h-5 rounded-full border-2 border-gray-300 mt-0.5 mr-3"></span>
                            <div>
                              <p className="text-gray-900">{item.text}</p>
                              <p className="text-sm text-gray-500">From: {item.meeting}</p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {/* Cross References */}
                  {selectedBriefing.summary.cross_references.length > 0 && (
                    <section>
                      <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
                        <svg className="w-5 h-5 mr-2 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                        </svg>
                        Cross-References
                      </h3>
                      <div className="space-y-3">
                        {selectedBriefing.summary.cross_references.map((ref, i) => (
                          <div key={i} className="bg-purple-50 rounded-lg p-3">
                            <p className="font-medium text-purple-900">{ref.topic}</p>
                            <p className="text-sm text-purple-700 mt-1">
                              Mentioned in: {ref.meetings.join(', ')}
                            </p>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Meeting Summaries */}
                  {selectedBriefing.summary.meeting_summaries.length > 0 && (
                    <section>
                      <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
                        <svg className="w-5 h-5 mr-2 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        Meeting Summaries
                      </h3>
                      <div className="space-y-4">
                        {selectedBriefing.summary.meeting_summaries.map((meeting, i) => (
                          <div key={i} className="border border-gray-200 rounded-lg p-4">
                            <h4 className="font-medium text-gray-900">{meeting.title}</h4>
                            <p className="text-gray-600 mt-1">{meeting.summary}</p>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Empty State */}
                  {selectedBriefing.summary.meeting_count === 0 && (
                    <div className="text-center py-8">
                      <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                      </svg>
                      <h3 className="mt-2 text-sm font-medium text-gray-900">No meetings found</h3>
                      <p className="mt-1 text-sm text-gray-500">
                        There were no meetings recorded on this date.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
                <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <h3 className="mt-2 text-sm font-medium text-gray-900">Select a briefing</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Choose a briefing from the list or generate a new one.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </Shell>
  )
}
