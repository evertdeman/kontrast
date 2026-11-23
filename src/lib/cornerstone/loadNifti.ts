/**
 * Render NIfTI volumes through Cornerstone's official NIfTI loader
 * (@cornerstonejs/nifti-volume-loader, which parses with nifti-reader-js).
 *
 * NIfTI is rendered in a Volume viewport (which the loader is built for):
 * Cornerstone's volume renderer handles the float data that intensity-scaled
 * NIfTI produces, and computes a volume-wide window — the stack renderer does
 * neither reliably. `createNiftiImageIdsAndCacheMetadata` gives one image id
 * per slice (with plane/pixel metadata); a streaming volume is built from them.
 *
 * Fully client-side: a file is turned into an in-memory `blob:` object URL and
 * the loader fetches that. Nothing leaves the tab; the app's CSP still blocks
 * every remote connection (it allows `blob:`, which is local-only, for this).
 */
import { cache, metaData, registerImageLoader, volumeLoader, type Types } from '@cornerstonejs/core'
import {
  cornerstoneNiftiImageLoader,
  createNiftiImageIdsAndCacheMetadata,
  init as niftiLoaderInit,
} from '@cornerstonejs/nifti-volume-loader'
import type { DicomTags } from '@/lib/dicom/parse'
import { readNiftiBytes } from '@/lib/nifti/detect'

const SCHEME = 'nifti'
/** Scheme for the streaming volume id; falls back to the streaming volume loader. */
const VOLUME_SCHEME = 'cornerstoneStreamingImageVolume'
/** Active object URLs (one per volume), so they can be revoked on release. */
const objectUrls = new Set<string>()
let loaderRegistered = false

/** The Cornerstone volume id for a NIfTI study's slice image ids. */
function niftiVolumeId(imageIds: string[]): string {
  return `${VOLUME_SCHEME}:${niftiVolumeIdOf(imageIds[0]) ?? imageIds[0]}`
}

/** Build and start loading the streaming volume for these slices; returns its id. */
export async function ensureNiftiVolume(imageIds: string[]): Promise<string> {
  const volumeId = niftiVolumeId(imageIds)
  if (!cache.getVolume(volumeId) && !cache.getVolumeLoadObject(volumeId)) {
    const volume = await volumeLoader.createAndCacheVolume(volumeId, { imageIds })
    void volume.load()
  }
  return volumeId
}

/** The object URL behind a `nifti:<url>?frame=<k>` image id, or null. */
export function niftiVolumeIdOf(imageId: string): string | null {
  if (!imageId.startsWith(`${SCHEME}:`)) return null
  return imageId.slice(SCHEME.length + 1).split('?frame=')[0] || null
}

/**
 * The library's loader returns slices with no window/level set. The volume
 * viewport computes its own window from the whole volume, but the single-image
 * canvas path (study-list thumbnails) needs one, so default each slice to its
 * own intensity range.
 */
function loadNiftiSlice(imageId: string, options: unknown) {
  const inner = (cornerstoneNiftiImageLoader as (id: string, o: unknown) => {
    promise: Promise<Types.IImage>
    cancelFn?: () => void
    decache?: () => void
  })(imageId, options)
  return {
    ...inner,
    promise: inner.promise.then((image) => {
      if (image.windowWidth == null) {
        const { minPixelValue: min, maxPixelValue: max } = image
        image.windowCenter = (min + max) / 2
        // Use the actual range; floating-point volumes can span < 1.
        image.windowWidth = max > min ? max - min : 1
      }
      return image
    }),
  }
}

/** Register the NIfTI image loader once, globally. */
export function registerNiftiImageLoader() {
  if (loaderRegistered) return
  niftiLoaderInit()
  registerImageLoader(SCHEME, loadNiftiSlice as Parameters<typeof registerImageLoader>[1])
  loaderRegistered = true
}

/** Strip the directory and NIfTI extension from a file name, for display. */
function baseName(name: string): string {
  return name.replace(/^.*\//, '').replace(/\.nii(\.gz)?$/i, '') || 'NIfTI volume'
}

const fmt = (n: unknown): string =>
  typeof n === 'number' && Number.isFinite(n) ? String(Number(n.toFixed(4))) : ''

const vec = (v: unknown): string =>
  Array.isArray(v) ? v.map(fmt).filter(Boolean).join('\\') : ''

/** Build a DICOM-style header for one NIfTI slice from the loader's cached metadata. */
function buildTags(imageId: string, sliceIndex: number, volumeId: string, description: string): DicomTags {
  const plane = (metaData.get('imagePlaneModule', imageId) ?? {}) as {
    rows?: number
    columns?: number
    imageOrientationPatient?: number[]
    imagePositionPatient?: number[]
    rowPixelSpacing?: number
    columnPixelSpacing?: number
    sliceThickness?: number
    sliceLocation?: number
  }
  const orientation =
    plane.imageOrientationPatient && plane.imageOrientationPatient.length === 6
      ? plane.imageOrientationPatient
      : null
  const position = plane.imagePositionPatient ?? null

  const summary: Record<string, string> = {
    StudyDescription: description,
    SeriesDescription: 'Volume',
    SeriesNumber: '1',
    InstanceNumber: String(sliceIndex + 1),
    Rows: plane.rows != null ? String(plane.rows) : '',
    Columns: plane.columns != null ? String(plane.columns) : '',
    PixelSpacing: `${fmt(plane.rowPixelSpacing)}\\${fmt(plane.columnPixelSpacing)}`,
    SliceThickness: fmt(plane.sliceThickness),
    SliceLocation: fmt(plane.sliceLocation),
    ImagePositionPatient: vec(position),
    PhotometricInterpretation: 'MONOCHROME2',
  }
  if (orientation) summary.ImageOrientationPatient = vec(orientation)
  for (const key of Object.keys(summary)) if (!summary[key]) delete summary[key]

  return {
    studyUID: `nifti-study-${volumeId}`,
    seriesUID: `nifti-series-${volumeId}`,
    sopUID: `nifti-${volumeId}-${sliceIndex}`,
    sopClassUID: '',
    modality: '',
    studyDescription: description,
    seriesDescription: 'Volume',
    studyDate: '',
    patientName: '',
    patientId: '',
    patientSex: '',
    seriesNumber: 1,
    instanceNumber: sliceIndex + 1,
    rows: plane.rows ?? null,
    columns: plane.columns ?? null,
    numberOfFrames: 1,
    imageOrientation: orientation,
    imagePosition: position,
    patientOrientation: null,
    accession: '',
    burnedInAnnotation: '',
    format: 'nifti',
    summary,
  }
}

export interface NiftiRegistration {
  volumeId: string
  imageIds: string[]
  /** One synthesised DICOM-style header per slice, in display order. */
  perSliceTags: DicomTags[]
}

/**
 * Parse a NIfTI file via the Cornerstone loader and return its slice image ids
 * and synthesised per-slice tags. The file becomes an in-memory object URL;
 * `.nii.gz` is decompressed first (blob URLs drop the extension the loader's
 * metadata fetch keys on, though the slice loader itself handles gzip).
 */
export async function addNiftiVolume(file: File): Promise<NiftiRegistration> {
  const bytes = await readNiftiBytes(file)
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }))
  objectUrls.add(url)
  let imageIds: string[]
  try {
    imageIds = await createNiftiImageIdsAndCacheMetadata({ url })
  } catch (err) {
    releaseNiftiVolume(url)
    throw err
  }
  if (imageIds.length === 0) {
    releaseNiftiVolume(url)
    throw new Error('NIfTI file has no image frames')
  }
  const description = baseName(file.name)
  const perSliceTags = imageIds.map((imageId, k) => buildTags(imageId, k, url, description))
  return { volumeId: url, imageIds, perSliceTags }
}

/** Drop the cached streaming volume built from a NIfTI object URL, if any. */
function purgeVolume(url: string) {
  const volumeId = `${VOLUME_SCHEME}:${url}`
  if (cache.getVolumeLoadObject(volumeId)) {
    try {
      cache.removeVolumeLoadObject(volumeId)
    } catch {
      /* already gone */
    }
  }
}

/** Release a NIfTI volume's object URL and cached volume; slices are dropped by the caller. */
export function releaseNiftiVolume(volumeId: string) {
  if (objectUrls.delete(volumeId)) {
    purgeVolume(volumeId)
    URL.revokeObjectURL(volumeId)
  }
}

/** Release every parsed NIfTI volume. */
export function clearNiftiVolumes() {
  for (const url of objectUrls) {
    purgeVolume(url)
    URL.revokeObjectURL(url)
  }
  objectUrls.clear()
}
