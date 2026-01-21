/* eslint-disable @typescript-eslint/no-require-imports */
import * as cheerio from 'cheerio'
import { convert } from 'html-to-text'

// mammoth doesn't have proper ESM exports, use require
const mammoth = require('mammoth')
const PDFParser = require('pdf2json')

export type DocumentFormat = 'pdf' | 'docx' | 'md' | 'txt' | 'html'

export interface ParsedDocument {
  content: string
  title?: string
  wordCount: number
  format: DocumentFormat
}

/**
 * Parse a PDF file and extract text content
 */
export async function parsePDF(buffer: Buffer): Promise<ParsedDocument> {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser()

    pdfParser.on('pdfParser_dataError', (errData: { parserError: Error }) => {
      reject(errData.parserError)
    })

    pdfParser.on('pdfParser_dataReady', (pdfData: { Pages: Array<{ Texts: Array<{ R: Array<{ T: string }> }> }> }) => {
      // Extract text from all pages
      let content = ''
      for (const page of pdfData.Pages || []) {
        for (const text of page.Texts || []) {
          for (const r of text.R || []) {
            content += decodeURIComponent(r.T) + ' '
          }
        }
        content += '\n'
      }
      content = content.trim()

      // Try to extract title from first line
      const lines = content.split('\n').filter((line: string) => line.trim())
      const title = lines[0]?.slice(0, 200) || undefined

      resolve({
        content,
        title,
        wordCount: countWords(content),
        format: 'pdf',
      })
    })

    pdfParser.parseBuffer(buffer)
  })
}

/**
 * Parse a DOCX file and extract text content
 */
export async function parseDOCX(buffer: Buffer): Promise<ParsedDocument> {
  const result = await mammoth.extractRawText({ buffer })
  const content = result.value.trim()

  // Try to extract title from first line
  const lines = content.split('\n').filter((line: string) => line.trim())
  const title = lines[0]?.slice(0, 200) || undefined

  return {
    content,
    title,
    wordCount: countWords(content),
    format: 'docx',
  }
}

/**
 * Parse a Markdown file (no conversion needed, just clean up)
 */
export function parseMarkdown(text: string): ParsedDocument {
  const content = text.trim()

  // Try to extract title from first heading
  const headingMatch = content.match(/^#\s+(.+)$/m)
  const title = headingMatch?.[1]?.slice(0, 200) || undefined

  return {
    content,
    title,
    wordCount: countWords(content),
    format: 'md',
  }
}

/**
 * Parse a plain text file
 */
export function parseText(text: string): ParsedDocument {
  const content = text.trim()

  // Try to extract title from first line
  const lines = content.split('\n').filter((line: string) => line.trim())
  const title = lines[0]?.slice(0, 200) || undefined

  return {
    content,
    title,
    wordCount: countWords(content),
    format: 'txt',
  }
}

/**
 * Parse HTML content and extract text
 */
export function parseHTML(html: string): ParsedDocument {
  const $ = cheerio.load(html)

  // Try to extract title
  const title = $('title').text() || $('h1').first().text() || undefined

  // Remove script, style, nav, footer, header elements
  $('script, style, nav, footer, header, aside, .nav, .footer, .header, .sidebar').remove()

  // Convert to plain text
  const content = convert($.html(), {
    wordwrap: false,
    selectors: [
      { selector: 'a', options: { ignoreHref: true } },
      { selector: 'img', format: 'skip' },
    ],
  }).trim()

  return {
    content,
    title: title?.slice(0, 200),
    wordCount: countWords(content),
    format: 'html',
  }
}

/**
 * Detect document format from filename
 */
export function detectFormat(filename: string): DocumentFormat | null {
  const ext = filename.toLowerCase().split('.').pop()

  switch (ext) {
    case 'pdf':
      return 'pdf'
    case 'docx':
      return 'docx'
    case 'md':
    case 'markdown':
      return 'md'
    case 'txt':
      return 'txt'
    case 'html':
    case 'htm':
      return 'html'
    default:
      return null
  }
}

/**
 * Parse a document based on its format
 */
export async function parseDocument(
  data: Buffer | string,
  format: DocumentFormat
): Promise<ParsedDocument> {
  switch (format) {
    case 'pdf':
      if (typeof data === 'string') {
        throw new Error('PDF parsing requires Buffer input')
      }
      return parsePDF(data)

    case 'docx':
      if (typeof data === 'string') {
        throw new Error('DOCX parsing requires Buffer input')
      }
      return parseDOCX(data)

    case 'md':
      return parseMarkdown(typeof data === 'string' ? data : data.toString('utf-8'))

    case 'txt':
      return parseText(typeof data === 'string' ? data : data.toString('utf-8'))

    case 'html':
      return parseHTML(typeof data === 'string' ? data : data.toString('utf-8'))

    default:
      throw new Error(`Unsupported format: ${format}`)
  }
}

/**
 * Count words in text
 */
function countWords(text: string): number {
  return text.split(/\s+/).filter((word: string) => word.length > 0).length
}

/**
 * Chunk text into smaller pieces for embedding
 */
export function chunkText(
  text: string,
  maxChunkSize: number = 1000,
  overlap: number = 100
): string[] {
  const chunks: string[] = []
  const sentences = text.split(/(?<=[.!?])\s+/)

  let currentChunk = ''

  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim())
      // Start new chunk with overlap from end of previous
      const words = currentChunk.split(' ')
      const overlapWords = words.slice(-Math.ceil(overlap / 5))
      currentChunk = overlapWords.join(' ') + ' ' + sentence
    } else {
      currentChunk += (currentChunk ? ' ' : '') + sentence
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim())
  }

  return chunks
}
