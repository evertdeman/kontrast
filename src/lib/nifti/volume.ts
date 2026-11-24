/**
 * Read NIfTI-1 and NIfTI-2 volumes (.nii, .nii.gz) and lay out their slices
 * the way the viewer shows DICOM. No Cornerstone dependency, so it can be
 * unit-tested.
 *
 * Slices follow the file's third axis, as acquired. Within a slice, rows and
 * columns are flipped or swapped into the usual radiological view (axial:
 * anterior up, patient left on the right; coronal and sagittal: superior up).
 * Shown in storage order, most NIfTI files would be upside down.
 */
import { NIFTI1, NIFTI2, isNIFTI1, isNIFTI2 } from 'nifti-reader-js'
import { SkipError } from '@/lib/dicom/parse'

export type NiftiHeader = NIFTI1 | NIFTI2
export type Vec3 = [number, number, number]

interface VoxelArrayType {
  new (buffer: ArrayBuffer): ArrayLike<number>
  readonly BYTES_PER_ELEMENT: number
}

/** Voxel types we can show, by NIfTI datatype code; others (RGB, complex) are skipped. */
const VOXEL_TYPES: Record<number, VoxelArrayType> = {
  2: Uint8Array,
  4: Int16Array,
  8: Int32Array,
  16: Float32Array,
  64: Float64Array,
  256: Int8Array,
  512: Uint16Array,
  768: Uint32Array,
}

/**
 * The first `length` bytes of a file, gunzipping on the fly if it is
 * compressed, so a header or the first volume of a 4D file can be read without
 * decompressing the rest. Shorter if the file is.
 */
async function readPrefix(file: Blob, length: number): Promise<ArrayBuffer> {
  const magic = new Uint8Array(await file.slice(0, 2).arrayBuffer())
  if (magic[0] !== 0x1f || magic[1] !== 0x8b) return file.slice(0, length).arrayBuffer()

  const out = new Uint8Array(length)
  let filled = 0
  const reader = file.stream().pipeThrough(new DecompressionStream('gzip')).getReader()
  try {
    while (filled < length) {
      const { done, value } = await reader.read()
      if (done) break
      const n = Math.min(value.length, length - filled)
      out.set(value.subarray(0, n), filled)
      filled += n
    }
  } finally {
    reader.cancel().catch(() => {})
  }
  return out.buffer.slice(0, filled)
}

/** The file's NIfTI header, or null if it isn't a single-file NIfTI. */
export async function readNiftiHeader(file: Blob): Promise<NiftiHeader | null> {
  const bytes = await readPrefix(file, 540)
  // Pass the header alone, so no extensions are read past the bytes we have.
  if (isNIFTI1(bytes)) {
    const header = new NIFTI1()
    header.readHeader(bytes.slice(0, 348))
    return header
  }
  if (isNIFTI2(bytes)) {
    const header = new NIFTI2()
    header.readHeader(bytes)
    return header
  }
  return null
}

export interface NiftiLayout {
  columns: number
  rows: number
  slices: number
  /** Volumes in a 4D file; only the first is shown. */
  volumes: number
  /** Patient (LPS) directions of a row and of a column, as in ImageOrientationPatient. */
  rowCosines: Vec3
  columnCosines: Vec3
  /** Millimetres between columns, rows and slices. */
  columnSpacing: number
  rowSpacing: number
  sliceSpacing: number
  /** Patient position of slice 0's first pixel, and the step from one slice to the next. */
  origin: Vec3
  sliceStep: Vec3
  /** Where each displayed pixel is in the file's voxel array. */
  voxels: { start: number; column: number; row: number; slice: number }
}

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = (a: number[]) => Math.hypot(a[0], a[1], a[2])
const scale = (a: number[], s: number): Vec3 => [a[0] * s || 0, a[1] * s || 0, a[2] * s || 0]

/**
 * Display layout and patient geometry for a header. Throws a SkipError for
 * voxel types we can't show.
 */
export function niftiLayout(header: NiftiHeader): NiftiLayout {
  const Voxel = VOXEL_TYPES[header.datatypeCode]
  if (Voxel?.BYTES_PER_ELEMENT * 8 !== header.numBitsPerVoxel) throw new SkipError('unsupported')

  const { dims, affine } = header
  const size = (d: number) => (d <= dims[0] ? Math.max(1, dims[d]) : 1)
  const n = [size(1), size(2), size(3)]
  const stride = [1, n[0], n[0] * n[1]]

  // The affine maps voxel indices to RAS millimetres; DICOM uses LPS.
  const lps = [-1, -1, 1]
  const axes = [0, 1, 2].map((c) => {
    const axis = [0, 1, 2].map((r) => lps[r] * affine[r][c])
    return norm(axis) > 0 ? axis : [0, 1, 2].map((r) => (r === c ? 1 : 0))
  })

  // Screen right and down for the standard plane closest to the slices.
  const normal = axes[2].map(Math.abs)
  const [right, down] =
    normal[2] >= normal[0] && normal[2] >= normal[1]
      ? [[1, 0, 0], [0, 1, 0]] // axial
      : normal[1] >= normal[0]
        ? [[1, 0, 0], [0, 0, -1]] // coronal
        : [[0, 1, 0], [0, 0, -1]] // sagittal

  // The in-plane axis closer to screen-right runs along a row; the other down a column.
  const alignment = (axis: number[]) => Math.abs(dot(axis, right)) / norm(axis)
  const h = alignment(axes[0]) >= alignment(axes[1]) ? 0 : 1
  const v = 1 - h
  const hSign = dot(axes[h], right) < 0 ? -1 : 1
  const vSign = dot(axes[v], down) < 0 ? -1 : 1

  // Voxel index of the top-left pixel.
  const first = [0, 0]
  first[h] = hSign < 0 ? n[h] - 1 : 0
  first[v] = vSign < 0 ? n[v] - 1 : 0

  return {
    columns: n[h],
    rows: n[v],
    slices: n[2],
    volumes: size(4),
    rowCosines: scale(axes[h], hSign / norm(axes[h])),
    columnCosines: scale(axes[v], vSign / norm(axes[v])),
    columnSpacing: norm(axes[h]),
    rowSpacing: norm(axes[v]),
    sliceSpacing: norm(axes[2]),
    origin: [0, 1, 2].map(
      (r) => lps[r] * affine[r][3] + first[0] * axes[0][r] + first[1] * axes[1][r],
    ) as Vec3,
    sliceStep: axes[2] as Vec3,
    voxels: {
      start: first[0] * stride[0] + first[1] * stride[1],
      column: hSign * stride[h],
      row: vSign * stride[v],
      slice: stride[2],
    },
  }
}

/** Patient position (ImagePositionPatient) of a slice's first pixel. */
export function slicePosition(layout: NiftiLayout, slice: number): Vec3 {
  return layout.origin.map((o, r) => o + slice * layout.sliceStep[r]) as Vec3
}

export interface NiftiPixels {
  /** The first volume in display order: slice after slice, row after row. */
  data: Float32Array
  min: number
  max: number
  /** Initial window: the header's display range, else the full data range. */
  windowCenter: number
  windowWidth: number
}

/**
 * Read the first volume's voxels into one float array, scaled to real-world
 * values and reordered for display in a single pass.
 */
export async function readNiftiPixels(
  file: Blob,
  header: NiftiHeader,
  layout: NiftiLayout,
): Promise<NiftiPixels> {
  const Voxel = VOXEL_TYPES[header.datatypeCode]
  const count = layout.columns * layout.rows * layout.slices
  const offset = header.vox_offset
  const size = count * Voxel.BYTES_PER_ELEMENT
  const buffer = await readPrefix(file, offset + size)
  if (buffer.byteLength < offset + size) throw new Error('NIfTI file is truncated')
  const bytes = new Uint8Array(buffer, offset, size)
  if (!header.littleEndian) {
    for (let i = 0; i < size; i += Voxel.BYTES_PER_ELEMENT) {
      bytes.subarray(i, i + Voxel.BYTES_PER_ELEMENT).reverse()
    }
  }
  const voxels = new Voxel(buffer.slice(offset, offset + size))

  // A slope of 0 means the values are stored unscaled.
  const slope = header.scl_slope || 1
  const intercept = (header.scl_slope && header.scl_inter) || 0
  const data = new Float32Array(count)
  const { start, column, row, slice } = layout.voxels
  let min = Infinity
  let max = -Infinity
  let p = 0
  for (let k = 0; k < layout.slices; k++) {
    for (let r = 0; r < layout.rows; r++) {
      let s = start + k * slice + r * row
      for (let c = 0; c < layout.columns; c++, s += column) {
        const value = voxels[s] * slope + intercept
        data[p++] = value
        if (value < min) min = value
        if (value > max) max = value
      }
    }
  }
  if (!(max >= min)) min = max = 0

  const [low, high] = header.cal_max > header.cal_min ? [header.cal_min, header.cal_max] : [min, max]
  return { data, min, max, windowCenter: (low + high) / 2, windowWidth: high > low ? high - low : 1 }
}
