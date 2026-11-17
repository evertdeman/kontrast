/** Collect File objects from file inputs, drag-and-drop, zip archives and the bundled sample. */
import { unzip, type Unzipped } from 'fflate'

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

const isZip = (file: File) =>
  /\.zip$/i.test(file.name) ||
  file.type === 'application/zip' ||
  file.type === 'application/x-zip-compressed'

/** Folders, plus the metadata macOS Finder adds to zips it creates. */
const isZipJunk = (path: string) =>
  path.endsWith('/') ||
  path.startsWith('__MACOSX/') ||
  /(^|\/)\._/.test(path) ||
  /(^|\/)\.DS_Store$/.test(path)

function unzipAsync(data: Uint8Array): Promise<Unzipped> {
  return new Promise((resolve, reject) =>
    unzip(data, { filter: (entry) => !isZipJunk(entry.name) }, (err, out) =>
      err ? reject(err) : resolve(out),
    ),
  )
}

export interface ExpandedFiles {
  files: File[]
  /** Archives that could not be read (damaged, encrypted or unsupported). */
  failedArchives: number
}

/** Replace .zip archives, including nested ones, with the files inside them. */
export async function expandArchives(files: File[], depth = 0): Promise<ExpandedFiles> {
  const out: File[] = []
  let failedArchives = 0
  for (const file of files) {
    if (!isZip(file) || depth >= MAX_ARCHIVE_DEPTH) {
      out.push(file)
      continue
    }
    try {
      const entries = await unzipAsync(new Uint8Array(await file.arrayBuffer()))
      const inner = Object.entries(entries).map(
        ([path, data]) => new File([data as Uint8Array<ArrayBuffer>], path.split('/').pop()!),
      )
      const nested = await expandArchives(inner, depth + 1)
      out.push(...nested.files)
      failedArchives += nested.failedArchives
    } catch {
      failedArchives += 1
    }
  }
  return { files: out, failedArchives }
}
