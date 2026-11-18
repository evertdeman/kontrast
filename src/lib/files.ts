/** Collect File objects from file inputs, drag-and-drop, zip archives and the bundled sample. */
import { readZip } from '@/lib/zip'

export const toFiles = (list: FileList | null): File[] => (list ? Array.from(list) : [])

function readEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject))
}

async function walkEntry(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    )
    out.push(file)
    return
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    // readEntries returns results in batches; keep reading until empty.
    for (;;) {
      const batch = await readEntries(reader)
      if (batch.length === 0) break
      await Promise.all(batch.map((e) => walkEntry(e, out)))
    }
  }
}

/**
 * Files from a drop, descending into dropped folders. `dataTransfer.files`
 * alone only lists the folder itself, not its contents.
 */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const entries = Array.from(dt.items)
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry())
    .filter((e): e is FileSystemEntry => e !== null)

  if (entries.length === 0) return toFiles(dt.files)

  const out: File[] = []
  await Promise.all(entries.map((e) => walkEntry(e, out)))
  return out
}

/** Download the bundled synthetic sample study (served from /sample). */
export async function loadSampleFiles(): Promise<File[]> {
  const base = `${import.meta.env.BASE_URL}sample/`
  const res = await fetch(`${base}manifest.json`)
  if (!res.ok) throw new Error(`Sample manifest: HTTP ${res.status}`)
  const { files } = (await res.json()) as { files: string[] }
  return Promise.all(
    files.map(async (name) => {
      const r = await fetch(base + name)
      if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`)
      return new File([await r.blob()], name, { type: 'application/dicom' })
    }),
  )
}

const MAX_ARCHIVE_DEPTH = 2
/** Entries inflated at once; enough to keep the decompressor busy. */
const UNZIP_CONCURRENCY = 4

const isZip = (file: File) =>
  /\.zip$/i.test(file.name) ||
  file.type === 'application/zip' ||
  file.type === 'application/x-zip-compressed'

/** Folders, plus the metadata macOS Finder adds to zips it creates. */
const isZipJunk = (path: string) =>
  path.startsWith('__MACOSX/') || /(^|\/)\._/.test(path) || /(^|\/)\.DS_Store$/.test(path)

/** Run `fn` over `items` with at most `limit` calls in flight, keeping order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

export interface ExpandedFiles {
  files: File[]
  /** Archives that could not be read, or only in part (damaged, encrypted or unsupported). */
  failedArchives: number
}

export interface ExpandOptions {
  /** Called as archive entries are unpacked; `total` grows as nested archives are found. */
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
}

/**
 * Replace .zip archives, including nested ones, with the files inside them.
 * Entries are unpacked a few at a time, so archives larger than memory work.
 */
export async function expandArchives(
  files: File[],
  { onProgress, signal }: ExpandOptions = {},
): Promise<ExpandedFiles> {
  let failedArchives = 0
  let done = 0
  let total = 0

  async function expand(file: File, depth: number): Promise<File[]> {
    if (!isZip(file) || depth >= MAX_ARCHIVE_DEPTH) return [file]
    let entries
    try {
      entries = (await readZip(file)).filter((entry) => !isZipJunk(entry.path))
    } catch {
      failedArchives += 1
      return []
    }
    total += entries.length
    onProgress?.(done, total)
    let damaged = false
    const nested = await mapLimit(entries, UNZIP_CONCURRENCY, async (entry) => {
      signal?.throwIfAborted()
      try {
        const name = entry.path.split('/').pop()!
        return await expand(new File([await entry.extract()], name), depth + 1)
      } catch (err) {
        if (signal?.aborted) throw err
        damaged = true
        return []
      } finally {
        done += 1
        onProgress?.(done, total)
      }
    })
    if (damaged) failedArchives += 1
    return nested.flat()
  }

  const expanded = await Promise.all(files.map((file) => expand(file, 0)))
  return { files: expanded.flat(), failedArchives }
}
