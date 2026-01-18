'use client'

import { useState, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import Shell from '@/components/Shell'

interface Company {
  id: string
  name: string
  type: 'customer' | 'prospect' | 'partner' | 'vendor' | 'competitor' | 'internal' | 'unknown'
  confidence: number
  mentionCount: number
  firstMentioned: string
  lastMentioned: string
  lastMentionedFormatted: string
  employeeCount: number
}

interface CompaniesResponse {
  count: number
  typeStats: Record<string, number>
  companies: Company[]
}

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  customer: { label: 'Customer', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  prospect: { label: 'Prospect', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  partner: { label: 'Partner', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  vendor: { label: 'Vendor', color: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
  competitor: { label: 'Competitor', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
  internal: { label: 'Internal', color: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30' },
  unknown: { label: 'Unknown', color: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30' },
}

// Wrapper component to handle Suspense for useSearchParams
export default function CompaniesPage() {
  return (
    <Suspense fallback={
      <Shell>
        <div className="max-w-6xl">
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            <span className="ml-3 text-gray-500 dark:text-gray-400">Loading companies...</span>
          </div>
        </div>
      </Shell>
    }>
      <CompaniesContent />
    </Suspense>
  )
}

function CompaniesContent() {
  const searchParams = useSearchParams()
  const initialSearch = searchParams.get('search') || ''

  const [companies, setCompanies] = useState<Company[]>([])
  const [typeStats, setTypeStats] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState(initialSearch)
  const [filterType, setFilterType] = useState<string | null>(null)

  // Filter companies by search query and type
  const filteredCompanies = companies.filter(company => {
    const matchesSearch = company.name.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesType = !filterType || company.type === filterType
    return matchesSearch && matchesType
  })

  useEffect(() => {
    async function fetchCompanies() {
      try {
        const response = await fetch('/api/companies')
        if (!response.ok) {
          throw new Error(`Failed to fetch companies: ${response.status}`)
        }
        const data: CompaniesResponse = await response.json()
        setCompanies(data.companies)
        setTypeStats(data.typeStats)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }

    fetchCompanies()
  }, [])

  return (
    <Shell>
      <div className="max-w-6xl">
        {/* Page header */}
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Companies</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Organizations mentioned in your meetings</p>
        </div>

        {/* Type filter pills */}
        {!loading && Object.keys(typeStats).length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            <button
              onClick={() => setFilterType(null)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filterType === null
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
              }`}
            >
              All ({companies.length})
            </button>
            {Object.entries(typeStats)
              .sort((a, b) => b[1] - a[1])
              .map(([type, count]) => (
                <button
                  key={type}
                  onClick={() => setFilterType(type)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    filterType === type
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                  }`}
                >
                  {TYPE_LABELS[type]?.label || type} ({count})
                </button>
              ))}
          </div>
        )}

        {/* Search input */}
        {!loading && companies.length > 0 && (
          <div className="mb-6">
            <div className="relative max-w-md">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <input
                type="text"
                placeholder="Search companies..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="block w-full pl-10 pr-10 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            <span className="ml-3 text-gray-500 dark:text-gray-400">Loading companies...</span>
          </div>
        )}

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <p className="font-medium text-red-800 dark:text-red-400">Error loading companies</p>
            <p className="text-sm mt-1 text-red-600 dark:text-red-500">{error}</p>
          </div>
        )}

        {!loading && !error && companies.length === 0 && (
          <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">No companies found yet</p>
            <p className="text-xs text-gray-400 dark:text-gray-500">Run the company extraction script to populate this list</p>
          </div>
        )}

        {!loading && !error && companies.length > 0 && (
          <>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              {searchQuery || filterType
                ? `${filteredCompanies.length} of ${companies.length} companies`
                : `${companies.length} companies found`}
            </p>
            {filteredCompanies.length === 0 ? (
              <div className="text-center py-8 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
                <p className="text-gray-500 dark:text-gray-400">No companies match your filters</p>
                <button
                  onClick={() => { setSearchQuery(''); setFilterType(null); }}
                  className="mt-2 text-sm text-primary-600 hover:text-primary-700"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredCompanies.map((company) => (
                  <CompanyCard key={company.id} company={company} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Shell>
  )
}

function CompanyCard({ company }: { company: Company }) {
  const initials = company.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const typeInfo = TYPE_LABELS[company.type] || TYPE_LABELS.unknown

  return (
    <Link
      href={`/companies/${encodeURIComponent(company.id)}`}
      className="block bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 hover:border-primary-300 dark:hover:border-primary-700 transition-colors"
    >
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 rounded-lg flex items-center justify-center text-lg font-medium flex-shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-medium text-gray-900 dark:text-white truncate">{company.name}</h3>
            <span className={`text-xs px-2 py-0.5 rounded-full border ${typeInfo.color}`}>
              {typeInfo.label}
            </span>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {company.mentionCount} mention{company.mentionCount !== 1 ? 's' : ''}
            {company.employeeCount > 0 && ` - ${company.employeeCount} contact${company.employeeCount !== 1 ? 's' : ''}`}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-4 mt-4 pt-3 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
        <span className="flex items-center gap-1">
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
          </svg>
          {company.lastMentionedFormatted}
        </span>
        {company.confidence > 0 && (
          <span className="flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            {company.confidence}%
          </span>
        )}
      </div>
    </Link>
  )
}
