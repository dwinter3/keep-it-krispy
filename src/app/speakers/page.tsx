import Shell from '@/components/Shell'

export default function SpeakersPage() {
  return (
    <Shell>
      <div className="max-w-4xl">
        <h1 className="text-3xl font-bold mb-2">Speakers</h1>
        <p className="text-zinc-400 mb-8">Your contacts from meeting transcripts</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SpeakerCard
            name="Sandeep Chellingi"
            role="Head of Cloud Practice"
            company="Orion Innovation"
            meetings={1}
            lastSeen="Today"
          />
          <SpeakerCard
            name="Dan Schultz"
            role="FSI Partner Development Specialist"
            company="AWS"
            meetings={1}
            lastSeen="Today"
          />
          <SpeakerCard
            name="Michelle"
            role="PDS - Migration/Modernization"
            company="AWS"
            meetings={1}
            lastSeen="Today"
          />
          <SpeakerCard
            name="Carolyn Cronin"
            role="AWS Alliance Manager"
            company="Orion Innovation"
            meetings={1}
            lastSeen="Today"
          />
        </div>
      </div>
    </Shell>
  )
}

function SpeakerCard({
  name,
  role,
  company,
  meetings,
  lastSeen,
}: {
  name: string
  role: string
  company: string
  meetings: number
  lastSeen: string
}) {
  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 hover:border-zinc-700 transition-colors cursor-pointer">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 bg-zinc-800 rounded-full flex items-center justify-center text-lg font-medium">
          {name.split(' ').map(n => n[0]).join('')}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium truncate">{name}</h3>
          <p className="text-sm text-zinc-400 truncate">{role}</p>
          <p className="text-xs text-zinc-500">{company}</p>
        </div>
      </div>
      <div className="flex items-center gap-4 mt-4 text-xs text-zinc-500">
        <span>{meetings} meeting{meetings !== 1 ? 's' : ''}</span>
        <span>Last seen: {lastSeen}</span>
      </div>
    </div>
  )
}
