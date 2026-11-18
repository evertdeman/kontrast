/**
 * Rewrite a study's files (anonymised or with edited tags) and stream them
 * into a zip, written to disk via the File System Access API where available,
 * or offered as a download.
 */
import { Zip, ZipDeflate } from 'fflate'
import { createAnonymizer, type AnonymizeOptions } from '@/lib/dicom/anonymize'
import { createTagEditor, type EditOptions, type TagEdit } from '@/lib/dicom/editTags'

/** Where the zip's bytes go. */
export interface ZipSink {
  write(chunk: Uint8Array): Promise<void>
  close(): Promise<void>
  abort(): Promise<void>
}

export interface ExportResult {
  written: number
  /** Files that could not be rewritten and were left out. */
  failed: number
}

export interface ExportEntry {
  /** Path inside the zip. */
  path: string
  file: File
  seriesUID: string
}

interface ExportOptions {
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
}

const pad = (n: number, width: number) => String(n).padStart(width, '0')

/** fflate writes plain zip, without the ZIP64 extensions for larger archives. */
const MAX_ENTRIES = 0xffff
const MAX_ZIP_BYTES = 0xffffffff

/**
 * Rewrite every file with `transform` and write it to `sink` as a zip. Files
 * that fail are left out rather than copied unchanged.
 */
async function writeZip(
  entries: ExportEntry[],
  transform: (bytes: ArrayBuffer, entry: ExportEntry) => ArrayBuffer,
  sink: ZipSink,
  { onProgress, signal }: ExportOptions = {},
): Promise<ExportResult> {
  const total = entries.length
  let written = 0
  let failed = 0

  let pending = Promise.resolve()
  let zipError: Error | null = null
  let zipBytes = 0
  const zip = new Zip((err, chunk) => {
    zipBytes += chunk?.length ?? 0
    if (err) zipError = err
    else if (zipBytes > MAX_ZIP_BYTES) zipError = new Error('The zip would be larger than 4 GB.')
    if (!zipError) pending = pending.then(() => sink.write(chunk))
  })

  try {
    if (total > MAX_ENTRIES) {
      throw new Error(`A zip can hold at most ${MAX_ENTRIES.toLocaleString()} files.`)
    }
    for (const entry of entries) {
      signal?.throwIfAborted()
      let bytes: ArrayBuffer
      try {
        bytes = transform(await entry.file.arrayBuffer(), entry)
      } catch (err) {
        console.warn(`Could not rewrite ${entry.file.name}`, err)
        failed += 1
        onProgress?.(written + failed, total)
        continue
      }
      const zipEntry = new ZipDeflate(entry.path, { level: 1 })
      zip.add(zipEntry)
      zipEntry.push(new Uint8Array(bytes), true)
      // Wait for the sink so at most one file's output is held in memory.
      await pending
      if (zipError) throw zipError
      signal?.throwIfAborted()
      written += 1
      onProgress?.(written + failed, total)
    }
    if (written === 0) throw new Error('None of the files could be read as DICOM.')
    signal?.throwIfAborted()
    zip.end()
    await pending
    if (zipError) throw zipError
    await sink.close()
    return { written, failed }
  } catch (err) {
    zip.terminate()
    await pending.catch(() => {})
    await sink.abort().catch(() => {})
    throw err
  }
}

/**
 * Anonymise every file and write it to `sink` as a zip. Entries are named by
 * position (`series-01/0001.dcm`), since original file names can contain
 * patient names.
 */
export function writeAnonymizedZip(
  series: File[][],
  sink: ZipSink,
  { options, ...rest }: ExportOptions & { options?: Partial<AnonymizeOptions> } = {},
): Promise<ExportResult> {
  const anonymizer = createAnonymizer(options)
  return writeZip(positionalEntries(series), (bytes) => anonymizer.anonymize(bytes), sink, rest)
}

function positionalEntries(series: File[][]): ExportEntry[] {
  return series.flatMap((files, s) =>
    files.map((file, i) => ({
      path: `series-${pad(s + 1, 2)}/${pad(i + 1, 4)}.dcm`,
      file,
      seriesUID: '',
    })),
  )
}

/** How Kontrast made a copy it opened, so the copy can be downloaded again. */
export type CopyKind = 'anonymised' | 'edited'

const copies = new WeakMap<File, CopyKind>()

/** Whether Kontrast made this file, and how; undefined for the user's own files. */
export function copyKindOf(file: File | undefined): CopyKind | undefined {
  return file && copies.get(file)
}

/** Rewrite files into new File objects, e.g. to open them in Kontrast. */
async function transformFiles(
  entries: ExportEntry[],
  transform: (bytes: ArrayBuffer, entry: ExportEntry) => ArrayBuffer,
  kind: CopyKind,
  { onProgress, signal }: ExportOptions = {},
): Promise<{ files: File[]; failed: number }> {
  const files: File[] = []
  let failed = 0
  for (const [i, entry] of entries.entries()) {
    signal?.throwIfAborted()
    try {
      const bytes = transform(await entry.file.arrayBuffer(), entry)
      const file = new File([bytes], entry.path.split('/').pop()!, { type: 'application/dicom' })
      copies.set(file, kind)
      files.push(file)
    } catch (err) {
      console.warn(`Could not rewrite ${entry.file.name}`, err)
      failed += 1
    }
    onProgress?.(i + 1, entries.length)
  }
  return { files, failed }
}

/** Anonymise files and return the results as new files. */
export function anonymizeFiles(
  series: File[][],
  { options, ...rest }: ExportOptions & { options?: Partial<AnonymizeOptions> } = {},
): Promise<{ files: File[]; failed: number }> {
  const anonymizer = createAnonymizer(options)
  return transformFiles(positionalEntries(series), (bytes) => anonymizer.anonymize(bytes), 'anonymised', rest)
}

/** Write files to `sink` as a zip as they are, in a folder per series. */
export function writeFilesZip(
  series: ExportSeries[],
  sink: ZipSink,
  rest: ExportOptions = {},
): Promise<ExportResult> {
  return writeZip(namedEntries(series), (bytes) => bytes, sink, rest)
}

/** A series of a study, for naming its folder in an export. */
export interface ExportSeries {
  seriesUID: string
  description: string
  files: File[]
}

/**
 * Entries that keep the original file names, in one folder per series
 * ("01 Axial/IM0001.dcm"). Clashing names in a folder get a number.
 */
export function namedEntries(series: ExportSeries[]): ExportEntry[] {
  return series.flatMap(({ seriesUID, description, files }, s) => {
    const folder = `${pad(s + 1, 2)} ${description.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Series'}`
    const used = new Map<string, number>()
    return files.map((file) => {
      const name = file.name || 'image.dcm'
      const count = (used.get(name) ?? 0) + 1
      used.set(name, count)
      const unique = count === 1 ? name : name.replace(/(\.[^.]*)?$/, `-${count}$1`)
      return { path: `${folder}/${unique}`, file, seriesUID }
    })
  })
}

/** Apply tag edits to every file and write them to `sink` as a zip. */
export function writeEditedZip(
  series: ExportSeries[],
  edits: TagEdit[],
  options: EditOptions,
  sink: ZipSink,
  rest: ExportOptions = {},
): Promise<ExportResult> {
  const editor = createTagEditor(edits, options)
  return writeZip(namedEntries(series), (bytes, e) => editor.edit(bytes, e.seriesUID), sink, rest)
}

/** Apply tag edits and return the results as new files. */
export function editFiles(
  series: ExportSeries[],
  edits: TagEdit[],
  options: EditOptions,
  rest: ExportOptions = {},
): Promise<{ files: File[]; failed: number }> {
  const editor = createTagEditor(edits, options)
  return transformFiles(namedEntries(series), (bytes, e) => editor.edit(bytes, e.seriesUID), 'edited', rest)
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
    async abort() {
      await stream.abort()
      // The picker has already created an empty file; remove it where supported.
      await (handle as { remove?: () => Promise<void> }).remove?.()
    },
  }
}

export const isAbortError = (err: unknown) =>
  err instanceof DOMException && err.name === 'AbortError'
