/**
 * Register user-selected DICOM File objects into Cornerstone's in-memory store,
 * and parse the header tags we need for grouping/display straight from the bytes
 * with dicom-parser (deterministic, independent of Cornerstone's async metadata).
 *
 * IMPORTANT: 100% client-side. Files are read with the File API and registered
 * via `prefetchPart10Instance`. No network, no upload, no persistence.
 */
import { wadouri, prefetchPart10Instance } from '@cornerstonejs/dicom-image-loader'
import {
  SkipError,
  emptySkipCounts,
  frameImageIds,
  looksLikeDicom,
  parseTags,
  type DicomTags,
  type SkipReason,
} from '@/lib/dicom/parse'

export { describeSkipped, type DicomTags, type SkipReason } from '@/lib/dicom/parse'

/** One DICOM file (SOP instance); multi-frame files have one imageId per frame. */
export interface RegisteredInstance {
  imageIds: string[]
  bytes: number
  tags: DicomTags
}

export interface IndexingProgress {
  done: number
  total: number
  /** True while zip archives are being unpacked, before indexing starts. */
  unpacking?: boolean
}

export interface RegisterResult {
  instances: RegisteredInstance[]
  skipped: Record<SkipReason, number>
}

/** imageId → parsed header tags, for grouping and the viewer/inspector. */
const tagRegistry = new Map<string, DicomTags>()
/** imageId → source File, so the full header can be re-read on demand. */
const fileRegistry = new Map<string, File>()

export function getImageTags(imageId: string): DicomTags | undefined {
  return tagRegistry.get(imageId)
}

export function getImageFile(imageId: string): File | undefined {
  return fileRegistry.get(imageId)
}

export function clearImageTags() {
  tagRegistry.clear()
  fileRegistry.clear()
}

/**
 * Register each file and return one entry per DICOM instance. Reports
 * progress, and counts files that were skipped and why.
 */
export async function registerFiles(
  files: File[],
  onProgress?: (done: number, total: number) => void,
): Promise<RegisterResult> {
  const skipped = emptySkipCounts()
  // DICOMDIR is only an index of the other files.
  const candidates = files.filter((file) => !/^dicomdir$/i.test(file.name))
  const total = candidates.length
  const instances: RegisteredInstance[] = []
  let done = 0

  const CONCURRENCY = 6
  let cursor = 0

  async function worker() {
    while (cursor < candidates.length) {
      const file = candidates[cursor++]
      try {
        if (!(await looksLikeDicom(file))) throw new SkipError('notDicom')
        const bytes = new Uint8Array(await file.arrayBuffer())
        const tags = parseTags(bytes)
        const baseImageId = wadouri.fileManager.add(file)
        await prefetchPart10Instance(baseImageId, bytes)
        const imageIds = frameImageIds(baseImageId, tags.numberOfFrames)
        for (const imageId of imageIds) {
          tagRegistry.set(imageId, tags)
          fileRegistry.set(imageId, file)
        }
        instances.push({ imageIds, bytes: file.size, tags })
      } catch (err) {
        skipped[err instanceof SkipError ? err.reason : 'notDicom'] += 1
      } finally {
        done += 1
        onProgress?.(done, total)
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, candidates.length) || 1 }, worker),
  )

  return { instances, skipped }
}
