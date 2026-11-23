/**
 * Register user-selected DICOM File objects into Cornerstone's in-memory store,
 * and parse the header tags we need for grouping/display straight from the bytes
 * with dicom-parser (deterministic, independent of Cornerstone's async metadata).
 *
 * IMPORTANT: 100% client-side. Files are read with the File API and registered
 * via `prefetchPart10Instance`. No network, no upload, no persistence.
 */
import { cache } from '@cornerstonejs/core'
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
import { looksLikeNifti } from '@/lib/nifti/detect'
import {
  addNiftiVolume,
  clearNiftiVolumes,
  niftiVolumeIdOf,
  releaseNiftiVolume,
} from '@/lib/cornerstone/loadNifti'

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
/** Base imageIds handed out by Cornerstone's file manager ("dicomfile:<n>"). */
const managedImageIds = new Set<string>()
/** SOPInstanceUIDs already registered, so adding the same files again skips them. */
const sopInstanceUids = new Set<string>()

const baseImageId = (imageId: string) => imageId.split('?')[0]

export function getImageTags(imageId: string): DicomTags | undefined {
  return tagRegistry.get(imageId)
}

export function getImageFile(imageId: string): File | undefined {
  return fileRegistry.get(imageId)
}

/**
 * Forget every registered file and drop Cornerstone's cached images.
 *
 * Files are released one by one rather than with `fileManager.purge()`, which
 * would restart imageIds at "dicomfile:0". Cornerstone's metadata store keeps
 * its entries for old imageIds, so reused ids would show the previous
 * session's images.
 */
export function clearRegisteredFiles() {
  for (const imageId of managedImageIds) {
    wadouri.fileManager.remove(Number(imageId.slice('dicomfile:'.length)))
  }
  managedImageIds.clear()
  sopInstanceUids.clear()
  tagRegistry.clear()
  fileRegistry.clear()
  clearNiftiVolumes()
  wadouri.dataSetCacheManager.purge()
  cache.purgeCache()
}

/**
 * Forget some registered images, e.g. when a study is removed from the list,
 * and drop their decoded pixels from Cornerstone's caches.
 */
export function releaseImages(imageIds: string[]) {
  for (const imageId of imageIds) {
    const sopUid = tagRegistry.get(imageId)?.sopUID
    if (sopUid) sopInstanceUids.delete(sopUid)
    tagRegistry.delete(imageId)
    fileRegistry.delete(imageId)
    if (cache.getImageLoadObject(imageId)) cache.removeImageLoadObject(imageId, { force: true })
  }
  for (const base of new Set(imageIds.map(baseImageId))) {
    if (!managedImageIds.delete(base)) continue
    const index = base.slice('dicomfile:'.length)
    wadouri.fileManager.remove(Number(index))
    // Each frame that was loaded holds a reference to the file's dataset.
    for (let i = 0; i < 10_000 && wadouri.dataSetCacheManager.isLoaded(index); i++) {
      wadouri.dataSetCacheManager.unload(index)
    }
  }
  // Drop the voxel data of any NIfTI volumes among these images.
  for (const volumeId of new Set(imageIds.map(niftiVolumeIdOf))) {
    if (volumeId) releaseNiftiVolume(volumeId)
  }
}

/**
 * Parse a NIfTI file into a stack of slices and register each slice's tags and
 * source file. Throws a SkipError if the bytes turn out not to be usable NIfTI.
 */
async function registerNifti(
  file: File,
  instances: RegisteredInstance[],
  signal?: AbortSignal,
): Promise<void> {
  let reg
  try {
    reg = await addNiftiVolume(file)
  } catch (err) {
    throw new SkipError(/Unsupported NIfTI datatype/.test(String(err)) ? 'unsupported' : 'notDicom')
  }
  if (signal?.aborted) return
  reg.imageIds.forEach((imageId, k) => {
    tagRegistry.set(imageId, reg.perSliceTags[k])
    fileRegistry.set(imageId, file)
  })
  instances.push({
    imageIds: reg.imageIds,
    bytes: file.size,
    tags: reg.perSliceTags[0],
  })
}

/**
 * Register each file and return one entry per DICOM instance. Reports
 * progress, and counts files that were skipped and why. Once `signal` is
 * aborted, no further files are registered.
 */
export async function registerFiles(
  files: File[],
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
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
    while (cursor < candidates.length && !signal?.aborted) {
      const file = candidates[cursor++]
      try {
        if (await looksLikeNifti(file)) {
          await registerNifti(file, instances, signal)
          continue
        }
        if (!(await looksLikeDicom(file))) throw new SkipError('notDicom')
        const bytes = new Uint8Array(await file.arrayBuffer())
        const tags = parseTags(bytes)
        // The session may have been cleared while this file was being read.
        if (signal?.aborted) return
        if (tags.sopUID) {
          if (sopInstanceUids.has(tags.sopUID)) throw new SkipError('duplicate')
          sopInstanceUids.add(tags.sopUID)
        }
        const base = wadouri.fileManager.add(file)
        managedImageIds.add(base)
        await prefetchPart10Instance(base, bytes)
        if (signal?.aborted) return
        const imageIds = frameImageIds(base, tags.numberOfFrames)
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
