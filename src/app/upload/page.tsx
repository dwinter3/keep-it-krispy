'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Shell from '@/components/Shell'
import { parseTranscriptFile, validateParsedTranscript, type ParsedTranscriptData } from '@/lib/parsers/transcript-parser'

type TabType = 'transcripts' | 'files' | 'link' | 'drive'

interface UploadStatus {
  status: 'idle' | 'uploading' | 'parsing' | 'success' | 'error'
  message?: string
  documentId?: string
}

interface ImportedContent {
  title: string
  content: string
  format: string
  wordCount: number
  sourceUrl: string
}

interface TranscriptFile {
  file: File
  parsed: ParsedTranscriptData | null
  error: string | null
  selected: boolean
}

interface UploadResult {
  filename: string
  success: boolean
  meetingId?: string
  title?: string
  speakers?: string[]
  duration?: number
  error?: string
  warnings?: string[]
}

export default function UploadPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<TabType>('transcripts')
  const [dragActive, setDragActive] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>({ status: 'idle' })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const transcriptInputRef = useRef<HTMLInputElement>(null)

  // URL import state
  const [urlInput, setUrlInput] = useState('')
  const [importedContent, setImportedContent] = useState<ImportedContent | null>(null)
  const [importLoading, setImportLoading] = useState(false)

  // Transcript upload state
  const [transcriptFiles, setTranscriptFiles] = useState<TranscriptFile[]>([])
  const [transcriptDragActive, setTranscriptDragActive] = useState(false)
  const [uploadResults, setUploadResults] = useState<UploadResult[] | null>(null)

  // Handle drag events for documents
  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }, [])

  // Handle drag events for transcripts
  const handleTranscriptDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setTranscriptDragActive(true)
    } else if (e.type === 'dragleave') {
      setTranscriptDragActive(false)
    }
  }, [])

  // Handle file drop for documents
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files).filter(isValidFile)
      setSelectedFiles(prev => [...prev, ...files])
    }
  }, [])

  // Handle file drop for transcripts
  const handleTranscriptDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setTranscriptDragActive(false)

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files).filter(isValidTranscriptFile)
      await parseTranscriptFiles(files)
    }
  }, [])

  // Validate file type for documents
  const isValidFile = (file: File) => {
    const validTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'text/markdown',
    ]
    const validExtensions = ['.pdf', '.docx', '.txt', '.md']
    const extension = '.' + file.name.split('.').pop()?.toLowerCase()

    return validTypes.includes(file.type) || validExtensions.includes(extension)
  }

  // Validate file type for transcripts
  const isValidTranscriptFile = (file: File) => {
    const validExtensions = ['.vtt', '.txt']
    const extension = '.' + file.name.split('.').pop()?.toLowerCase()
    return validExtensions.includes(extension)
  }

  // Parse transcript files client-side for preview
  const parseTranscriptFiles = async (files: File[]) => {
    setUploadStatus({ status: 'parsing', message: 'Parsing transcript files...' })

    const parsedFiles: TranscriptFile[] = []

    for (const file of files) {
      try {
        const content = await file.text()
        const parsed = parseTranscriptFile(content, file.name)
        const validation = validateParsedTranscript(parsed)

        if (validation.valid) {
          parsedFiles.push({
            file,
            parsed,
            error: null,
            selected: true
          })
        } else {
          parsedFiles.push({
            file,
            parsed,
            error: validation.errors.join('; '),
            selected: false
          })
        }
      } catch (err) {
        parsedFiles.push({
          file,
          parsed: null,
          error: err instanceof Error ? err.message : 'Parse error',
          selected: false
        })
      }
    }

    setTranscriptFiles(prev => [...prev, ...parsedFiles])
    setUploadStatus({ status: 'idle' })
  }

  // Handle file selection for documents
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files).filter(isValidFile)
      setSelectedFiles(prev => [...prev, ...files])
    }
  }

  // Handle file selection for transcripts
  const handleTranscriptSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files).filter(isValidTranscriptFile)
      await parseTranscriptFiles(files)
    }
    // Reset input to allow re-selecting same file
    if (transcriptInputRef.current) {
      transcriptInputRef.current.value = ''
    }
  }

  // Remove a file from selection
  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index))
  }

  // Remove a transcript file
  const removeTranscriptFile = (index: number) => {
    setTranscriptFiles(prev => prev.filter((_, i) => i !== index))
  }

  // Toggle transcript file selection
  const toggleTranscriptFile = (index: number) => {
    setTranscriptFiles(prev =>
      prev.map((f, i) =>
        i === index ? { ...f, selected: !f.selected && !f.error } : f
      )
    )
  }

  // Upload selected document files
  const uploadFiles = async () => {
    if (selectedFiles.length === 0) return

    setUploadStatus({ status: 'uploading', message: 'Uploading files...' })

    try {
      for (const file of selectedFiles) {
        const formData = new FormData()
        formData.append('file', file)

        const response = await fetch('/api/documents', {
          method: 'POST',
          body: formData,
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error || 'Upload failed')
        }
      }

      setUploadStatus({
        status: 'success',
        message: `Successfully uploaded ${selectedFiles.length} file(s)`,
      })
      setSelectedFiles([])

      // Redirect to documents page after short delay
      setTimeout(() => {
        router.push('/documents')
      }, 1500)
    } catch (error) {
      setUploadStatus({
        status: 'error',
        message: String(error),
      })
    }
  }

  // Upload selected transcript files
  const uploadTranscripts = async () => {
    const filesToUpload = transcriptFiles.filter(f => f.selected && !f.error)
    if (filesToUpload.length === 0) return

    setUploadStatus({ status: 'uploading', message: `Importing ${filesToUpload.length} transcript(s)...` })
    setUploadResults(null)

    try {
      const formData = new FormData()
      for (const tf of filesToUpload) {
        formData.append('files', tf.file)
      }

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Upload failed')
      }

      setUploadResults(data.results)

      const successful = data.summary?.successful || 0
      const failed = data.summary?.failed || 0

      if (failed === 0) {
        setUploadStatus({
          status: 'success',
          message: `Successfully imported ${successful} transcript(s)`,
        })
        setTranscriptFiles([])

        // Redirect to transcripts page after short delay
        setTimeout(() => {
          router.push('/transcripts')
        }, 2000)
      } else {
        setUploadStatus({
          status: 'error',
          message: `Imported ${successful} transcript(s), ${failed} failed`,
        })
      }
    } catch (error) {
      setUploadStatus({
        status: 'error',
        message: String(error),
      })
    }
  }

  // Import URL content
  const importUrl = async () => {
    if (!urlInput.trim()) return

    setImportLoading(true)
    setImportedContent(null)

    try {
      const response = await fetch('/api/documents/import-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Import failed')
      }

      setImportedContent(data)
    } catch (error) {
      setUploadStatus({
        status: 'error',
        message: String(error),
      })
    } finally {
      setImportLoading(false)
    }
  }

  // Save imported content
  const saveImportedContent = async () => {
    if (!importedContent) return

    setUploadStatus({ status: 'uploading', message: 'Saving document...' })

    try {
      const response = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: importedContent.title,
          content: importedContent.content,
          format: importedContent.format,
          wordCount: importedContent.wordCount,
          source: 'url',
          sourceUrl: importedContent.sourceUrl,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Save failed')
      }

      setUploadStatus({
        status: 'success',
        message: 'Document saved successfully!',
        documentId: data.documentId,
      })
      setImportedContent(null)
      setUrlInput('')

      // Redirect to documents page after short delay
      setTimeout(() => {
        router.push('/documents')
      }, 1500)
    } catch (error) {
      setUploadStatus({
        status: 'error',
        message: String(error),
      })
    }
  }

  // Format file size
  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  // Format duration
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    if (mins >= 60) {
      const hours = Math.floor(mins / 60)
      const remainingMins = mins % 60
      return `${hours}h ${remainingMins}m`
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  // Get file icon based on type
  const getFileIcon = (file: File) => {
    const extension = file.name.split('.').pop()?.toLowerCase()
    switch (extension) {
      case 'pdf':
        return (
          <svg className="w-8 h-8 text-red-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
          </svg>
        )
      case 'docx':
        return (
          <svg className="w-8 h-8 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
          </svg>
        )
      case 'vtt':
        return (
          <svg className="w-8 h-8 text-purple-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
          </svg>
        )
      default:
        return (
          <svg className="w-8 h-8 text-gray-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
          </svg>
        )
    }
  }

  const selectedTranscriptCount = transcriptFiles.filter(f => f.selected && !f.error).length

  return (
    <Shell>
      <div className="max-w-4xl">
        <h1 className="text-3xl font-bold mb-2 text-gray-900 dark:text-white">Upload</h1>
        <p className="text-gray-500 dark:text-gray-400 mb-8">Import content into your knowledge base</p>

        {/* Status Messages */}
        {uploadStatus.status !== 'idle' && (
          <div
            className={`mb-6 p-4 rounded-lg ${
              uploadStatus.status === 'uploading' || uploadStatus.status === 'parsing'
                ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400'
                : uploadStatus.status === 'success'
                ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
            }`}
          >
            <div className="flex items-center gap-3">
              {(uploadStatus.status === 'uploading' || uploadStatus.status === 'parsing') && (
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-current"></div>
              )}
              {uploadStatus.status === 'success' && (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              )}
              {uploadStatus.status === 'error' && (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              )}
              <span>{uploadStatus.message}</span>
            </div>
          </div>
        )}

        {/* Upload Results */}
        {uploadResults && uploadResults.length > 0 && (
          <div className="mb-6 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <h3 className="font-medium text-gray-900 dark:text-white">Import Results</h3>
            </div>
            <div className="divide-y divide-gray-200 dark:divide-gray-700 max-h-60 overflow-y-auto">
              {uploadResults.map((result, index) => (
                <div key={index} className="px-4 py-3 flex items-start gap-3">
                  {result.success ? (
                    <svg className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 dark:text-white text-sm truncate">
                      {result.title || result.filename}
                    </p>
                    {result.success ? (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {result.speakers?.join(', ')} - {formatDuration(result.duration || 0)}
                      </p>
                    ) : (
                      <p className="text-xs text-red-500 dark:text-red-400">{result.error}</p>
                    )}
                    {result.warnings && result.warnings.length > 0 && (
                      <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
                        Warning: {result.warnings.join('; ')}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-2 mb-6 flex-wrap">
          <TabButton active={activeTab === 'transcripts'} onClick={() => setActiveTab('transcripts')}>
            Transcripts
          </TabButton>
          <TabButton active={activeTab === 'files'} onClick={() => setActiveTab('files')}>
            Documents
          </TabButton>
          <TabButton active={activeTab === 'link'} onClick={() => setActiveTab('link')}>
            Paste Link
          </TabButton>
          <TabButton active={activeTab === 'drive'} onClick={() => setActiveTab('drive')}>
            Google Drive
          </TabButton>
        </div>

        {/* Transcripts Upload Tab */}
        {activeTab === 'transcripts' && (
          <div className="space-y-4">
            {/* Info banner */}
            <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4 flex gap-3">
              <svg className="w-5 h-5 text-purple-600 dark:text-purple-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <h4 className="font-medium text-purple-700 dark:text-purple-300">Import Microsoft Teams/Copilot Transcripts</h4>
                <p className="text-sm text-purple-600 dark:text-purple-400 mt-1">
                  Upload VTT or TXT transcript files exported from Microsoft Teams, Copilot, or other meeting platforms.
                  Files will be parsed and added to your transcript library.
                </p>
              </div>
            </div>

            {/* Drop Zone */}
            <div
              onDragEnter={handleTranscriptDrag}
              onDragLeave={handleTranscriptDrag}
              onDragOver={handleTranscriptDrag}
              onDrop={handleTranscriptDrop}
              onClick={() => transcriptInputRef.current?.click()}
              className={`bg-white dark:bg-gray-800 rounded-xl border-2 border-dashed p-12 cursor-pointer transition-colors ${
                transcriptDragActive
                  ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20'
                  : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
              }`}
            >
              <input
                ref={transcriptInputRef}
                type="file"
                multiple
                accept=".vtt,.txt"
                onChange={handleTranscriptSelect}
                className="hidden"
              />
              <div className="text-center">
                <div className="text-gray-400 dark:text-gray-500 mb-4">
                  <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
                    />
                  </svg>
                </div>
                <h3 className="text-lg font-medium mb-2 text-gray-900 dark:text-white">
                  {transcriptDragActive ? 'Drop transcripts here' : 'Upload Transcripts'}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                  Drag & drop transcript files or click to browse
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
                  Supports VTT (WebVTT) and TXT formats
                </p>
                <button
                  type="button"
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm font-medium text-white transition-colors"
                >
                  Choose Transcripts
                </button>
              </div>
            </div>

            {/* Selected Transcripts List */}
            {transcriptFiles.length > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                  <h3 className="font-medium text-gray-900 dark:text-white">
                    Parsed Transcripts ({transcriptFiles.length})
                  </h3>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {selectedTranscriptCount} selected for import
                  </span>
                </div>
                <div className="divide-y divide-gray-200 dark:divide-gray-700 max-h-96 overflow-y-auto">
                  {transcriptFiles.map((tf, index) => (
                    <div
                      key={index}
                      className={`px-4 py-3 flex items-start gap-4 ${
                        tf.error ? 'bg-red-50 dark:bg-red-900/10' : ''
                      }`}
                    >
                      {/* Checkbox */}
                      <div className="pt-1">
                        <input
                          type="checkbox"
                          checked={tf.selected}
                          onChange={() => toggleTranscriptFile(index)}
                          disabled={!!tf.error}
                          className="w-4 h-4 text-purple-600 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 rounded focus:ring-purple-500 focus:ring-2 disabled:opacity-50"
                        />
                      </div>

                      {/* File Icon */}
                      {getFileIcon(tf.file)}

                      {/* File Info */}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 dark:text-white truncate">
                          {tf.parsed?.title || tf.file.name}
                        </p>
                        {tf.error ? (
                          <p className="text-sm text-red-500 dark:text-red-400">{tf.error}</p>
                        ) : tf.parsed ? (
                          <div className="text-sm text-gray-500 dark:text-gray-400">
                            <span>{tf.parsed.speakers.length} speaker{tf.parsed.speakers.length !== 1 ? 's' : ''}</span>
                            <span className="mx-2">-</span>
                            <span>{formatDuration(tf.parsed.duration)}</span>
                            <span className="mx-2">-</span>
                            <span className="uppercase text-xs">{tf.parsed.format}</span>
                          </div>
                        ) : (
                          <p className="text-sm text-gray-500 dark:text-gray-400">Parsing...</p>
                        )}
                        {tf.parsed?.warnings && tf.parsed.warnings.length > 0 && (
                          <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
                            {tf.parsed.warnings.join('; ')}
                          </p>
                        )}
                        {tf.parsed?.speakers && tf.parsed.speakers.length > 0 && (
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 truncate">
                            {tf.parsed.speakers.slice(0, 4).join(', ')}
                            {tf.parsed.speakers.length > 4 && ` +${tf.parsed.speakers.length - 4} more`}
                          </p>
                        )}
                      </div>

                      {/* Remove Button */}
                      <button
                        onClick={() => removeTranscriptFile(index)}
                        className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                      >
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                          <path
                            fillRule="evenodd"
                            d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
                <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                  <button
                    onClick={uploadTranscripts}
                    disabled={selectedTranscriptCount === 0 || uploadStatus.status === 'uploading'}
                    className="w-full px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 rounded-lg text-sm font-medium text-white transition-colors flex items-center justify-center gap-2"
                  >
                    {uploadStatus.status === 'uploading' ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                        Importing...
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                          <path
                            fillRule="evenodd"
                            d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                        Import {selectedTranscriptCount} Transcript{selectedTranscriptCount !== 1 ? 's' : ''}
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* How to export guide */}
            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4">
              <h4 className="font-medium text-gray-700 dark:text-gray-300 mb-2">How to export from Microsoft Teams:</h4>
              <ol className="text-sm text-gray-600 dark:text-gray-400 space-y-2 list-decimal list-inside">
                <li>Open the meeting recording in Microsoft Teams</li>
                <li>Click the three dots (...) menu next to the transcript</li>
                <li>Select <strong>Download</strong> or <strong>Export transcript</strong></li>
                <li>Choose VTT or TXT format</li>
                <li>Upload the downloaded file here</li>
              </ol>
            </div>
          </div>
        )}

        {/* File Upload Tab */}
        {activeTab === 'files' && (
          <div className="space-y-4">
            {/* Drop Zone */}
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`bg-white dark:bg-gray-800 rounded-xl border-2 border-dashed p-12 cursor-pointer transition-colors ${
                dragActive
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
              }`}
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
                <div className="text-gray-400 dark:text-gray-500 mb-4">
                  <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                </div>
                <h3 className="text-lg font-medium mb-2 text-gray-900 dark:text-white">
                  {dragActive ? 'Drop files here' : 'Upload Documents'}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                  Drag & drop files or click to browse
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
                  Supports PDF, DOCX, TXT, and Markdown files
                </p>
                <button
                  type="button"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium text-white transition-colors"
                >
                  Choose Files
                </button>
              </div>
            </div>

            {/* Selected Files List */}
            {selectedFiles.length > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                  <h3 className="font-medium text-gray-900 dark:text-white">
                    Selected Files ({selectedFiles.length})
                  </h3>
                </div>
                <div className="divide-y divide-gray-200 dark:divide-gray-700">
                  {selectedFiles.map((file, index) => (
                    <div key={index} className="px-4 py-3 flex items-center gap-4">
                      {getFileIcon(file)}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 dark:text-white truncate">{file.name}</p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">{formatFileSize(file.size)}</p>
                      </div>
                      <button
                        onClick={() => removeFile(index)}
                        className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                      >
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                          <path
                            fillRule="evenodd"
                            d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
                <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                  <button
                    onClick={uploadFiles}
                    disabled={uploadStatus.status === 'uploading'}
                    className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg text-sm font-medium text-white transition-colors flex items-center justify-center gap-2"
                  >
                    {uploadStatus.status === 'uploading' ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                        Uploading...
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                          <path
                            fillRule="evenodd"
                            d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                        Upload {selectedFiles.length} File{selectedFiles.length > 1 ? 's' : ''}
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Link Import Tab */}
        {activeTab === 'link' && (
          <div className="space-y-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
              <h3 className="text-lg font-medium mb-4 text-gray-900 dark:text-white">Import from URL</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                Paste a link to a web page, article, or document. The content will be extracted and added to your knowledge base.
              </p>
              <div className="flex gap-3">
                <input
                  type="url"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="https://example.com/article"
                  className="flex-1 px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  onKeyDown={(e) => e.key === 'Enter' && importUrl()}
                />
                <button
                  onClick={importUrl}
                  disabled={importLoading || !urlInput.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg text-sm font-medium text-white transition-colors flex items-center gap-2"
                >
                  {importLoading ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      Fetching...
                    </>
                  ) : (
                    'Import'
                  )}
                </button>
              </div>
            </div>

            {/* Imported Content Preview */}
            {importedContent && (
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                  <h3 className="font-medium text-gray-900 dark:text-white">Preview</h3>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {importedContent.wordCount.toLocaleString()} words
                  </span>
                </div>
                <div className="p-4 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Title</label>
                    <input
                      type="text"
                      value={importedContent.title}
                      onChange={(e) => setImportedContent({ ...importedContent, title: e.target.value })}
                      className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Content Preview</label>
                    <div className="p-3 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg max-h-48 overflow-y-auto">
                      <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
                        {importedContent.content.slice(0, 1000)}
                        {importedContent.content.length > 1000 && '...'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z" />
                    </svg>
                    <span className="truncate">{importedContent.sourceUrl}</span>
                  </div>
                </div>
                <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 flex gap-3">
                  <button
                    onClick={() => setImportedContent(null)}
                    className="px-4 py-2 bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveImportedContent}
                    disabled={uploadStatus.status === 'uploading'}
                    className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg text-sm font-medium text-white transition-colors"
                  >
                    Save to Knowledge Base
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Google Drive Tab */}
        {activeTab === 'drive' && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
            <div className="text-center">
              <div className="text-gray-400 dark:text-gray-500 mb-4">
                <svg className="w-12 h-12 mx-auto" viewBox="0 0 87.3 78" fill="currentColor">
                  <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5l5.4 9.35z" fill="#0066DA" />
                  <path d="M43.65 25L29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3L1.2 52.85c-.8 1.4-1.2 2.95-1.2 4.5h27.5l16.15-28v-4.35z" fill="#00AC47" />
                  <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.85L73.55 76.8z" fill="#EA4335" />
                  <path d="M43.65 25L57.4 1.2c-1.35-.8-2.9-1.2-4.5-1.2H34.4c-1.6 0-3.15.45-4.5 1.2L43.65 25z" fill="#00832D" />
                  <path d="M59.85 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h36.6c1.6 0 3.15-.45 4.5-1.2L59.85 53z" fill="#2684FC" />
                  <path d="M73.4 26.5l-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25l16.2 28h27.45c0-1.55-.4-3.1-1.2-4.5l-12.7-22z" fill="#FFBA00" />
                </svg>
              </div>
              <h3 className="text-lg font-medium mb-2 text-gray-900 dark:text-white">Google Drive</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 max-w-md mx-auto">
                To import from Google Drive, download the file first and then upload it using the Documents tab.
              </p>
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 text-left max-w-md mx-auto">
                <h4 className="font-medium text-blue-700 dark:text-blue-400 mb-2">How to export from Google Drive:</h4>
                <ol className="text-sm text-blue-600 dark:text-blue-300 space-y-2 list-decimal list-inside">
                  <li>Open the file in Google Drive</li>
                  <li>Go to <strong>File &gt; Download</strong></li>
                  <li>Choose PDF, DOCX, or Plain Text format</li>
                  <li>Upload the downloaded file here</li>
                </ol>
              </div>
              <button
                onClick={() => setActiveTab('files')}
                className="mt-6 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium text-white transition-colors"
              >
                Go to Document Upload
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
          : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-300 dark:hover:bg-gray-600'
      }`}
    >
      {children}
    </button>
  )
}
