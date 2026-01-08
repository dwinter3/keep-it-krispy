import Shell from '@/components/Shell'

// Transcripts list page
export default function TranscriptsPage() {
  return (
    <Shell>
      <div className="max-w-4xl">
        <h1 className="text-3xl font-bold mb-2">Transcripts</h1>
        <p className="text-zinc-400 mb-8">All your meeting transcripts in one place</p>

        <div className="bg-zinc-900 rounded-xl border border-zinc-800 divide-y divide-zinc-800">
          <TranscriptRow
            title="AWS Partnership Sprint Discussion"
            date="Jan 7, 2026"
            duration="30 min"
            speakers={['David Winter', 'Sandeep Chellingi', 'Dan Schultz', 'Michelle']}
            source="krisp"
          />
          <TranscriptRow
            title="Hey, Let's get started with Krisp!"
            date="Jan 7, 2026"
            duration="1 min"
            speakers={['Bob', 'Anna']}
            source="krisp"
          />
        </div>
      </div>
    </Shell>
  )
}

function TranscriptRow({
  title,
  date,
  duration,
  speakers,
  source,
}: {
  title: string
  date: string
  duration: string
  speakers: string[]
  source: 'krisp' | 'teams'
}) {
  return (
    <div className="p-4 hover:bg-zinc-800/50 transition-colors cursor-pointer">
      <div className="flex items-start justify-between mb-2">
        <h3 className="font-medium">{title}</h3>
        <span className={`text-xs px-2 py-1 rounded ${
          source === 'krisp' ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'
        }`}>
          {source === 'krisp' ? 'Krisp' : 'Teams'}
        </span>
      </div>
      <div className="flex items-center gap-4 text-sm text-zinc-400">
        <span>{date}</span>
        <span>{duration}</span>
        <span>{speakers.length} speakers</span>
      </div>
      <div className="flex gap-2 mt-2">
        {speakers.slice(0, 3).map((speaker) => (
          <span key={speaker} className="text-xs bg-zinc-800 px-2 py-1 rounded">
            {speaker}
          </span>
        ))}
        {speakers.length > 3 && (
          <span className="text-xs text-zinc-500">+{speakers.length - 3} more</span>
        )}
      </div>
    </div>
  )
}
