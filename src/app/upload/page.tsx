'use client'

import { useState, useCallback, useRef } from 'react'
import Shell from '@/components/Shell'

interface UploadedFile {
  id: string
  name: string
  size: number
  status: 'pending' | 'uploading' | 'processing' | 'success' | 'error'
  progress?: number
  error?: string
  result?: {
    documentId: string
    textLength: number
    chunkCount: number
  }
}

const SUPPORTED_EXTENSIONS = ['pdf', 'docx', 'txt', 'md']
const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

export default function UploadPage() {
  const [activeTab, setActiveTab] = useState<'files' | 'teams' | 'link'>('files')
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const validateFile = (file: File): string | null => {
    const extension = file.name.split('.').pop()?.toLowerCase()
    if (!extension || !SUPPORTED_EXTENSIONS.includes(extension)) {
      return `Unsupported file type. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`
    }
    if (file.size > MAX_FILE_SIZE) {
      return `File too large. Maximum size: ${MAX_FILE_SIZE / 1024 / 1024}MB`
    }
    return null
  }

  const uploadFile = async (file: File, fileId: string) => {
    setFiles(prev => prev.map(f =>
      f.id === fileId ? { ...f, status: 'uploading', progress: 0 } : f
    ))

    try {
      const formData = new FormData()
      formData.append('file', file)

      setFiles(prev => prev.map(f =>
        f.id === fileId ? { ...f, status: 'processing', progress: 50 } : f
      ))

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || result.details || 'Upload failed')
      }

      setFiles(prev => prev.map(f =>
        f.id === fileId ? {
          ...f,
          status: 'success',
          progress: 100,
          result: {
            documentId: result.documentId,
            textLength: result.textLength,
            chunkCount: result.chunkCount,
          }
        } : f
      ))

    } catch (error) {
      setFiles(prev => prev.map(f =>
        f.id === fileId ? {
          ...f,
          status: 'error',
          error: error instanceof Error ? error.message : 'Upload failed'
        } : f
      ))
    }
  }

  const handleFiles = useCallback((fileList: FileList | File[]) => {
    const newFiles: UploadedFile[] = []

    for (const file of Array.from(fileList)) {
      const validationError = validateFile(file)
      const fileId = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`

      if (validationError) {
        newFiles.push({
          id: fileId,
          name: file.name,
          size: file.size,
          status: 'error',
          error: validationError,
        })
      } else {
        newFiles.push({
          id: fileId,
          name: file.name,
          size: file.size,
          status: 'pending',
        })
        // Start upload immediately
        uploadFile(file, fileId)
      }
    }

    setFiles(prev => [...prev, ...newFiles])
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files)
    }
  }, [handleFiles])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files)
    }
    // Reset input so same file can be selected again
    e.target.value = ''
  }, [handleFiles])

  const removeFile = useCallback((fileId: string) => {
    setFiles(prev => prev.filter(f => f.id !== fileId))
  }, [])

  const clearCompleted = useCallback(() => {
    setFiles(prev => prev.filter(f => f.status !== 'success' && f.status !== 'error'))
  }, [])

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const getStatusIcon = (status: UploadedFile['status']) => {
    switch (status) {
      case 'pending':
        return (
          <svg className="w-5 h-5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )
      case 'uploading':
      case 'processing':
        return (
          <svg className="w-5 h-5 text-blue-500 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        )
      case 'success':
        return (
          <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        )
      case 'error':
        return (
          <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        )
    }
  }

  const getFileTypeIcon = (fileName: string) => {
    const extension = fileName.split('.').pop()?.toLowerCase()
    switch (extension) {
      case 'pdf':
        return <span className="text-red-400 font-mono text-xs">PDF</span>
      case 'docx':
        return <span className="text-blue-400 font-mono text-xs">DOCX</span>
      case 'txt':
        return <span className="text-zinc-400 font-mono text-xs">TXT</span>
      case 'md':
        return <span className="text-purple-400 font-mono text-xs">MD</span>
      default:
        return <span className="text-zinc-400 font-mono text-xs">FILE</span>
    }
  }

  return (
    <Shell>
      <div className="max-w-4xl">
        <h1 className="text-3xl font-bold mb-2">Upload</h1>
        <p className="text-zinc-400 mb-8">Import content into your knowledge base</p>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          <TabButton active={activeTab === 'files'} onClick={() => setActiveTab('files')}>
            Files
          </TabButton>
          <TabButton active={activeTab === 'teams'} onClick={() => setActiveTab('teams')}>
            Teams/Copilot
          </TabButton>
          <TabButton active={activeTab === 'link'} onClick={() => setActiveTab('link')}>
            Paste Link
          </TabButton>
        </div>

        {/* File Upload */}
        {activeTab === 'files' && (
          <div className="space-y-4">
            {/* Drop Zone */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`
                bg-zinc-900 rounded-xl border-2 border-dashed p-12 cursor-pointer transition-all
                ${isDragging
                  ? 'border-blue-500 bg-blue-500/10'
                  : 'border-zinc-700 hover:border-zinc-600 hover:bg-zinc-800/50'
                }
              `}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.docx,.txt,.md"
                onChange={handleFileSelect}
                className="hidden"
              />
              <div className="text-center">
                <div className={`mb-4 transition-colors ${isDragging ? 'text-blue-400' : 'text-zinc-500'}`}>
                  <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium mb-2">
                  {isDragging ? 'Drop files here' : 'Upload Documents'}
                </h3>
                <p className="text-sm text-zinc-400 mb-4">
                  Drag & drop files or click to browse
                </p>
                <div className="flex flex-wrap justify-center gap-2 mb-4">
                  <span className="px-2 py-1 bg-red-500/20 text-red-400 rounded text-xs font-medium">PDF</span>
                  <span className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-xs font-medium">DOCX</span>
                  <span className="px-2 py-1 bg-zinc-500/20 text-zinc-400 rounded text-xs font-medium">TXT</span>
                  <span className="px-2 py-1 bg-purple-500/20 text-purple-400 rounded text-xs font-medium">MD</span>
                </div>
                <p className="text-xs text-zinc-500">
                  Maximum file size: 50MB
                </p>
              </div>
            </div>

            {/* File List */}
            {files.length > 0 && (
              <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
                  <h3 className="text-sm font-medium">
                    Uploaded Files ({files.length})
                  </h3>
                  {files.some(f => f.status === 'success' || f.status === 'error') && (
                    <button
                      onClick={clearCompleted}
                      className="text-xs text-zinc-400 hover:text-white transition-colors"
                    >
                      Clear completed
                    </button>
                  )}
                </div>
                <div className="divide-y divide-zinc-800">
                  {files.map(file => (
                    <div key={file.id} className="px-4 py-3 flex items-center gap-4">
                      <div className="w-10 h-10 bg-zinc-800 rounded-lg flex items-center justify-center">
                        {getFileTypeIcon(file.name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium truncate">{file.name}</p>
                          <span className="text-xs text-zinc-500">{formatFileSize(file.size)}</span>
                        </div>
                        {file.status === 'processing' && (
                          <p className="text-xs text-blue-400 mt-1">Processing and generating embeddings...</p>
                        )}
                        {file.status === 'success' && file.result && (
                          <p className="text-xs text-green-400 mt-1">
                            {file.result.chunkCount} chunks created from {(file.result.textLength / 1000).toFixed(1)}k characters
                          </p>
                        )}
                        {file.status === 'error' && (
                          <p className="text-xs text-red-400 mt-1">{file.error}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        {getStatusIcon(file.status)}
                        {(file.status === 'success' || file.status === 'error') && (
                          <button
                            onClick={() => removeFile(file.id)}
                            className="text-zinc-500 hover:text-zinc-300 transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Teams/Copilot Upload */}
        {activeTab === 'teams' && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 border-dashed p-12">
            <div className="text-center">
              <div className="text-zinc-500 mb-4">
                <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium mb-2">Teams/Copilot Transcripts</h3>
              <p className="text-sm text-zinc-400 mb-4">
                Upload Microsoft Teams meeting transcripts
              </p>
              <p className="text-xs text-zinc-500 mb-4">
                Supports VTT, DOCX, TXT exports from Teams/Copilot
              </p>
              <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors">
                Upload Transcripts
              </button>
            </div>
          </div>
        )}

        {/* Link Input */}
        {activeTab === 'link' && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
            <h3 className="text-lg font-medium mb-4">Import from URL</h3>
            <p className="text-sm text-zinc-400 mb-4">
              Paste a link to crawl and import content using Crawl4AI
            </p>
            <div className="flex gap-3">
              <input
                type="url"
                placeholder="https://example.com/article"
                className="flex-1 px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors">
                Import
              </button>
            </div>
          </div>
        )}
      </div>
    </Shell>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
        active
          ? 'bg-blue-600 text-white'
          : 'bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700'
      }`}
    >
      {children}
    </button>
  )
}
