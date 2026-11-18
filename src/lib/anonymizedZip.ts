/**
 * Anonymise a study's files and stream them into a zip, written to disk via
 * the File System Access API where available, or offered as a download.
 */
import { Zip, ZipDeflate } from 'fflate'
import { createAnonymizer } from '@/lib/dicom/anonymize'

/** Where the zip's bytes go. */
export interface ZipSink {
  write(chunk: Uint8Array): Promise<void>
  close(): Promise<void>
  abort(): Promise<void>
}

export interface AnonymizedZipResult {
  written: number
  /** Files that could not be anonymised and were left out. */
  failed: number
}

const pad = (n: number, width: number) => String(n).padStart(width, '0')

/**
 * Anonymise every file and write it to `sink` as a zip. Entries are named by
 * position (`series-01/0001.dcm`), since original file names can contain
 * patient names. Files that fail are left out rather than copied unchanged.
 */
export async function writeAnonymizedZip(
  series: File[][],
  sink: ZipSink,
  {
    onProgress,
    signal,
  }: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<AnonymizedZipResult> {
  const anonymizer = createAnonymizer()
  const total = series.reduce((n, files) => n + files.length, 0)
  let written = 0
  let failed = 0

  let pending = Promise.resolve()
  let zipError: Error | null = null
  const zip = new Zip((err, chunk) => {
    if (err) zipError = err
    else pending = pending.then(() => sink.write(chunk))
  })

  try {
    for (const [s, files] of series.entries()) {
      for (const [i, file] of files.entries()) {
        signal?.throwIfAborted()
        let bytes: ArrayBuffer
        try {
          bytes = anonymizer.anonymize(await file.arrayBuffer())
        } catch (err) {
          console.warn(`Could not anonymise ${file.name}`, err)
          failed += 1
          onProgress?.(written + failed, total)
          continue
        }
        const entry = new ZipDeflate(`series-${pad(s + 1, 2)}/${pad(i + 1, 4)}.dcm`, {
          level: 1,
        })
        zip.add(entry)
        entry.push(new Uint8Array(bytes), true)
        // Wait for the sink so at most one file's output is held in memory.
        await pending
        if (zipError) throw zipError
        written += 1
        onProgress?.(written + failed, total)
      }
    }
    if (written === 0) throw new Error('None of the files could be anonymised.')
    zip.end()
    await pending
    if (zipError) throw zipError
    await sink.close()
    return { written, failed }
  } catch (err) {
    zip.terminate()
    await pending.catch(() => {})
    await sink.abort()
    throw err
  }
}

/** Collects the zip in memory, then hands it to the browser as a download. */
export function downloadSink(fileName: string): ZipSink {
  let chunks: BlobPart[] = []
  return {
    async write(chunk) {
      chunks.push(chunk as Uint8Array<ArrayBuffer>)
    },
    async close() {
      const url = URL.createObjectURL(new Blob(chunks, { type: 'application/zip' }))
      chunks = []
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    },
    async abort() {
      chunks = []
    },
  }
}

type SaveFilePicker = (options: {
  suggestedName: string
  types: { description: string; accept: Record<string, string[]> }[]
}) => Promise<FileSystemFileHandle>

/**
 * Ask where to save the zip and stream straight to that file, so large
 * studies never sit in memory. Returns null when the browser lacks the File
 * System Access API. Throws an AbortError if the user cancels the picker.
 * Must be called from a user gesture.
 */
export async function pickFileSink(fileName: string): Promise<ZipSink | null> {
  const picker = (window as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker
  if (!picker) return null
  const handle = await picker.call(window, {
    suggestedName: fileName,
    types: [{ description: 'Zip archive', accept: { 'application/zip': ['.zip'] } }],
  })
  const stream = await handle.createWritable()
  return {
    write: (chunk) => stream.write(chunk as Uint8Array<ArrayBuffer>),
    close: () => stream.close(),
    abort: () => stream.abort(),
  }
}

export const isAbortError = (err: unknown) =>
  err instanceof DOMException && err.name === 'AbortError'
