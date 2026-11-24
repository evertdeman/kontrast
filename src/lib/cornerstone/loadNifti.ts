/**
 * Show NIfTI volumes (.nii, .nii.gz) the way Cornerstone intends: a real 3D
 * volume in an orthographic viewport, so orientation and windowing come from
 * the volume itself — no DICOM-stack emulation.
 *
 * The heavy lifting (header parsing, geometry, per-slice pixels) is done by the
 * official `@cornerstonejs/nifti-volume-loader`. This module only adapts it to
 * the app: it feeds files in from disk (no network), builds the lightweight
 * header the study list/inspector need, and cleans up afterwards.
 *
 * All in memory: nothing leaves the device. The loader fetches over a `blob:`
 * URL created from the File, which never touches the network.
 */
import {
  cache,
  Enums,
  metaData,
  registerImageLoader,
  utilities as csUtils,
  type Types,
} from '@cornerstonejs/core'
import {
  cornerstoneNiftiImageLoader,
  createNiftiImageIdsAndCacheMetadata,
  init as niftiLoaderInit,
} from '@cornerstonejs/nifti-volume-loader'
import { isNIFTI, readHeader, readImage, type NIFTI1, type NIFTI2 } from 'nifti-reader-js'
import { SkipError, type DicomTags } from '@/lib/dicom/parse'

export const NIFTI_FILE = /\.nii(\.gz)?$/i

const SCHEME = 'nifti:'
/** Enough bytes for a NIfTI-1 (348) or NIfTI-2 (540) header. */
const HEADER_BYTES = 540

/** Typed array per NIfTI datatype code, matching the loader's supported set. */
const VOXEL_TYPES: Record<number, { new (b: ArrayBuffer): ArrayLike<number> }> = {
  2: Uint8Array,
  4: Int16Array,
  8: Int32Array,
  16: Float32Array,
  64: Float64Array,
  256: Int8Array,
  512: Uint16Array,
  768: Uint32Array,
}

export interface VoiRange {
  lower: number
  upper: number
}

/**
 * Volumes are normalised to this integer-friendly range before rendering. A
 * volume's own units can be tiny (a 0–1 probability map), which GPUs without
 * 16-bit-normalised textures quantise down to a near-flat image; spreading the
 * values over a wide range keeps the detail on any hardware.
 */
const NORM_RANGE = 4096

/** Open volumes by their blob URL, so their object URLs can be revoked. */
const sessions = new Set<string>()
/** Precomputed display window (in normalised units) per volume id. */
const voiByVolume = new Map<string, VoiRange>()
/** Source value range per blob URL, to normalise each slice consistently. */
const rangeByUrl = new Map<string, { min: number; max: number }>()

/** The blob URL an image id was built from: `nifti:<url>?frame=<n>`. */
function urlOf(imageId: string): string {
  return imageId.slice(SCHEME.length).split('?frame=')[0]
}

export function isNiftiImageId(imageId: string): boolean {
  return imageId.startsWith(SCHEME)
}

/** The volume id for a NIfTI image id. One volume per file. */
export function niftiVolumeId(imageId: string): string {
  return `niftivol:${urlOf(imageId)}`
}

/**
 * The official loader, wrapped to normalise each slice to {@link NORM_RANGE}
 * using the volume's global value range (so every slice scales identically).
 */
function normalizingLoader(imageId: string): Types.IImageLoadObject {
  const obj = cornerstoneNiftiImageLoader(imageId) as Types.IImageLoadObject
  const range = rangeByUrl.get(urlOf(imageId))
  if (!range || !(range.max > range.min)) return obj
  const { min, max } = range
  const scale = NORM_RANGE / (max - min)
  const promise = obj.promise.then((image) => {
    const src = image.getPixelData() as ArrayLike<number>
    const out = new Float32Array(src.length)
    for (let i = 0; i < src.length; i++) out[i] = (src[i] - min) * scale
    image.getPixelData = () => out
    image.voxelManager = csUtils.VoxelManager.createImageVoxelManager({
      width: image.columns,
      height: image.rows,
      numberOfComponents: 1,
      scalarData: out,
    })
    image.dataType = 'Float32Array'
    image.minPixelValue = 0
    image.maxPixelValue = NORM_RANGE
    image.sizeInBytes = out.byteLength
    return image
  })
  return { ...obj, promise }
}

/** Map a source-unit window onto the normalised units the volume renders in. */
function normalizeVoi(voi: VoiRange, min: number, max: number): VoiRange {
  const scale = NORM_RANGE / (max - min)
  return { lower: (voi.lower - min) * scale, upper: (voi.upper - min) * scale }
}

let registered = false

/** Register the NIfTI image loader once, globally. */
export function registerNiftiImageLoader() {
  if (registered) return
  niftiLoaderInit({})
  registerImageLoader('nifti', normalizingLoader as Types.ImageLoaderFn)
  registered = true
}

/** Gunzip a `.nii.gz`, or pass a plain `.nii` through, as raw bytes. */
async function readNiftiBytes(file: File): Promise<Uint8Array> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer())
  const gzipped = head[0] === 0x1f && head[1] === 0x8b
  if (!gzipped) return new Uint8Array(await file.arrayBuffer())
  const stream = file.stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * A robust 2nd–98th percentile display window over the whole volume, in the
 * SAME units the viewer renders. Cornerstone windows a volume from its middle
 * slice's min/max, which leaves sparse maps (e.g. tissue-probability volumes
 * that are mostly zero) almost black; a percentile range — what neuroimaging
 * viewers use — brings out the structure.
 */
interface VoiStats {
  voi: VoiRange
  min: number
  max: number
}

function computeNiftiVoi(header: NIFTI1 | NIFTI2, bytes: Uint8Array): VoiStats | null {
  const Voxel = VOXEL_TYPES[header.datatypeCode]
  // Big-endian voxels aren't swapped here; leave those to the default window.
  if (!Voxel || !header.littleEndian) return null
  let raw: ArrayLike<number>
  try {
    raw = new Voxel(readImage(header, bytes.buffer.slice(0) as ArrayBuffer) as ArrayBuffer)
  } catch {
    return null
  }
  const n = raw.length
  if (!n) return null

  // Match the loader's modalityScaleNifti: scale only when both slope and
  // intercept are meaningful, so our window is in the volume's actual units.
  let slope = header.scl_slope
  let inter = header.scl_inter
  if (!slope || Number.isNaN(slope)) slope = 1
  if (!inter || Number.isNaN(inter)) inter = 0
  const scaled = slope !== 1 && inter !== 0
  const valueAt = (i: number) => (scaled ? raw[i] * slope + inter : raw[i])

  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < n; i++) {
    const v = valueAt(i)
    if (v !== v) continue
    if (v < min) min = v
    if (v > max) max = v
  }
  if (!(max > min)) return null

  const BINS = 1024
  const hist = new Uint32Array(BINS)
  const span = max - min
  let count = 0
  for (let i = 0; i < n; i++) {
    const v = valueAt(i)
    if (v !== v) continue
    let b = ((v - min) / span) * BINS
    b = b >= BINS ? BINS - 1 : b | 0
    hist[b]++
    count++
  }
  const at = (fraction: number, edge: number) => {
    const target = count * fraction
    let cum = 0
    for (let b = 0; b < BINS; b++) {
      cum += hist[b]
      if (cum >= target) return min + ((b + edge) / BINS) * span
    }
    return max
  }
  const lower = at(0.02, 0)
  const upper = at(0.98, 1)
  const voi = upper > lower ? { lower, upper } : { lower: min, upper: max }
  return { voi, min, max }
}

/** The precomputed display window for a NIfTI image's volume, if any. */
export function niftiVoiRange(imageId: string): VoiRange | undefined {
  return voiByVolume.get(niftiVolumeId(imageId))
}

const decimals = (values: number[]) => values.map((n) => String(Number(n.toFixed(4)))).join('\\')

/** A DICOM-style header for the study list and inspector. */
function buildTags(
  name: string,
  header: NIFTI1 | NIFTI2,
  plane: { imageOrientationPatient?: number[]; imagePositionPatient?: number[] } | undefined,
): DicomTags {
  const dims = header.dims
  const columns = dims[1]
  const rows = dims[2]
  const slices = Math.max(1, dims[3] ?? 1)
  const volumes = dims[0] >= 4 ? Math.max(1, dims[4] ?? 1) : 1

  const description = name.replace(NIFTI_FILE, '') || 'NIfTI volume'
  const seriesDescription = volumes > 1 ? `Volume 1 of ${volumes}` : 'Volume'
  // Patient orientation (the R/L/A/P labels) is only meaningful when the file
  // defines a real spatial transform. With neither qform nor sform, NIfTI falls
  // back to a voxel-axis default, so we leave orientation unknown rather than
  // guess L from R.
  const oriented = header.qform_code > 0 || header.sform_code > 0
  const orientation = oriented ? (plane?.imageOrientationPatient ?? null) : null
  const position = oriented ? (plane?.imagePositionPatient ?? null) : null
  const [rowSpacing, columnSpacing] = [header.pixDims[2], header.pixDims[1]]

  return {
    studyUID: urlFragment(name),
    seriesUID: urlFragment(name),
    sopUID: '',
    sopClassUID: '',
    modality: '',
    studyDescription: description,
    seriesDescription,
    studyDate: '',
    patientName: '',
    patientId: '',
    patientSex: '',
    seriesNumber: 1,
    instanceNumber: 1,
    rows,
    columns,
    numberOfFrames: slices,
    imageOrientation: orientation,
    imagePosition: position,
    patientOrientation: null,
    accession: '',
    burnedInAnnotation: '',
    format: 'nifti',
    summary: {
      StudyDescription: description,
      SeriesDescription: seriesDescription,
      Rows: String(rows),
      Columns: String(columns),
      NumberOfFrames: String(slices),
      PixelSpacing: decimals([rowSpacing, columnSpacing]),
      SpacingBetweenSlices: decimals([header.pixDims[3]]),
      ...(orientation ? { ImageOrientationPatient: decimals(orientation) } : {}),
    },
  }
}

/** Unique per file name + load, so study/series ids never collide or reuse. */
let seq = 0
function urlFragment(name: string): string {
  return `nifti-${seq++}-${name}`
}

/**
 * Index a NIfTI file: cache its volume metadata and return an imageId per
 * slice plus a header for the list. Throws a SkipError if it isn't NIfTI we
 * can show.
 */
export async function addNiftiFile(file: File): Promise<{ imageIds: string[]; tags: DicomTags }> {
  const bytes = await readNiftiBytes(file).catch(() => null)
  if (!bytes) throw new SkipError('notDicom')
  const headerBuffer = bytes.buffer.slice(0, HEADER_BYTES) as ArrayBuffer
  if (!isNIFTI(headerBuffer)) throw new SkipError('notDicom')
  const header = readHeader(headerBuffer)
  if (!header) throw new SkipError('notDicom')

  // A plain-NIfTI blob URL: the loader keys gzip off the URL extension, which a
  // blob URL lacks, so we hand it already-decompressed bytes.
  const url = URL.createObjectURL(new Blob([bytes as BlobPart]))
  let imageIds: string[]
  try {
    imageIds = await createNiftiImageIdsAndCacheMetadata({ url })
  } catch {
    URL.revokeObjectURL(url)
    throw new SkipError('unsupported')
  }
  if (!imageIds?.length) {
    URL.revokeObjectURL(url)
    throw new SkipError('unsupported')
  }
  sessions.add(url)

  const stats = computeNiftiVoi(header, bytes)
  if (stats) {
    rangeByUrl.set(url, { min: stats.min, max: stats.max })
    voiByVolume.set(niftiVolumeId(imageIds[0]), normalizeVoi(stats.voi, stats.min, stats.max))
  }

  const plane = metaData.get(Enums.MetadataModules.IMAGE_PLANE, imageIds[0]) as
    | { imageOrientationPatient?: number[]; imagePositionPatient?: number[] }
    | undefined
  return { imageIds, tags: buildTags(file.name, header, plane) }
}

/** Drop the cached volume and the object URL behind these images. */
export function releaseNiftiImages(imageIds: string[]) {
  for (const id of new Set(imageIds.filter(isNiftiImageId))) {
    const url = urlOf(id)
    if (!sessions.delete(url)) continue
    const volumeId = niftiVolumeId(id)
    voiByVolume.delete(volumeId)
    rangeByUrl.delete(url)
    if (cache.getVolume(volumeId)) cache.removeVolumeLoadObject(volumeId)
    URL.revokeObjectURL(url)
  }
}

export function clearNiftiVolumes() {
  for (const url of sessions) URL.revokeObjectURL(url)
  sessions.clear()
  voiByVolume.clear()
  rangeByUrl.clear()
}
