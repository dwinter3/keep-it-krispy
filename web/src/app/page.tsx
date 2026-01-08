import Shell from '@/components/Shell'

export default function DashboardPage() {
  return (
    <Shell>
      <div className="max-w-4xl">
        <h1 className="text-3xl font-bold mb-2">Dashboard</h1>
        <p className="text-zinc-400 mb-8">Your meeting intelligence at a glance</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <StatCard title="Transcripts" value="2" subtitle="This week" />
          <StatCard title="Speakers" value="5" subtitle="Total contacts" />
          <StatCard title="Documents" value="0" subtitle="Imported" />
        </div>

        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
          <h2 className="text-lg font-semibold mb-4">Recent Activity</h2>
          <div className="space-y-4">
            <ActivityItem
              title="AWS Partnership Sprint Discussion"
              subtitle="Transcript from Teams call"
              time="Today at 4:00 PM"
            />
            <ActivityItem
              title="Hey, Let's get started with Krisp!"
              subtitle="Test transcript"
              time="Today at 3:52 PM"
            />
          </div>
        </div>
      </div>
    </Shell>
  )
}

function StatCard({ title, value, subtitle }: { title: string; value: string; subtitle: string }) {
  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
      <p className="text-sm text-zinc-400 mb-1">{title}</p>
      <p className="text-3xl font-bold mb-1">{value}</p>
      <p className="text-xs text-zinc-500">{subtitle}</p>
    </div>
  )
}

function ActivityItem({ title, subtitle, time }: { title: string; subtitle: string; time: string }) {
  return (
    <div className="flex items-start justify-between py-3 border-b border-zinc-800 last:border-0">
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-sm text-zinc-400">{subtitle}</p>
      </div>
      <p className="text-xs text-zinc-500">{time}</p>
    </div>
  )
}
