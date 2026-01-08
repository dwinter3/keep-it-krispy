import Shell from '@/components/Shell'

export default function DocumentsPage() {
  return (
    <Shell>
      <div className="max-w-4xl">
        <h1 className="text-3xl font-bold mb-2">Documents</h1>
        <p className="text-zinc-400 mb-8">Imported documents and files</p>

        <div className="bg-zinc-900 rounded-xl border border-zinc-800 border-dashed p-12 text-center">
          <div className="text-zinc-500 mb-4">
            <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </div>
          <h3 className="text-lg font-medium mb-2">No documents yet</h3>
          <p className="text-sm text-zinc-400 mb-4">
            Import documents from Google Drive, upload files, or paste links to get started.
          </p>
          <div className="flex justify-center gap-3">
            <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors">
              Upload Files
            </button>
            <button className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm font-medium transition-colors">
              Connect Google Drive
            </button>
          </div>
        </div>
      </div>
    </Shell>
  )
}
