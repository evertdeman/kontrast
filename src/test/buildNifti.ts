/** Minimal single-file NIfTI-1 writer for tests: int16 voxels, sform geometry. */

export interface NiftiOptions {
  /** Voxels along i, j, k and, for 4D files, volumes. */
  dims: number[]
  /** sform rows (voxel index → RAS mm). Defaults to the identity. */
  affine?: number[][]
  value?: (i: number, j: number, k: number, t: number) => number
  slope?: number
  intercept?: number
  calMin?: number
  calMax?: number
  littleEndian?: boolean
  /** Header-only overrides, to describe voxel types the data doesn't use. */
  datatype?: number
  bitpix?: number
}

export function buildNifti({
  dims,
  affine = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]],
  value = () => 0,
  slope = 0,
  intercept = 0,
  calMin = 0,
  calMax = 0,
  littleEndian = true,
  datatype = 4,
  bitpix = 16,
}: NiftiOptions): Uint8Array {
  const [nI, nJ, nK, nT = 1] = dims
  const voxOffset = 352
  const buffer = new ArrayBuffer(voxOffset + nI * nJ * nK * nT * 2)
  const v = new DataView(buffer)
  const le = littleEndian
  v.setInt32(0, 348, le)
  ;[dims.length, nI, nJ, nK, nT, 1, 1, 1].forEach((d, i) => v.setInt16(40 + i * 2, d, le))
  v.setInt16(70, datatype, le)
  v.setInt16(72, bitpix, le)
  ;[1, 1, 1, 1, 1, 0, 0, 0].forEach((d, i) => v.setFloat32(76 + i * 4, d, le))
  v.setFloat32(108, voxOffset, le)
  v.setFloat32(112, slope, le)
  v.setFloat32(116, intercept, le)
  v.setFloat32(124, calMax, le)
  v.setFloat32(128, calMin, le)
  v.setInt16(254, 1, le) // sform_code
  affine.forEach((row, r) => row.forEach((x, c) => v.setFloat32(280 + (r * 4 + c) * 4, x, le)))
  'n+1\0'.split('').forEach((ch, i) => v.setUint8(344 + i, ch.charCodeAt(0)))
  let offset = voxOffset
  for (let t = 0; t < nT; t++) {
    for (let k = 0; k < nK; k++) {
      for (let j = 0; j < nJ; j++) {
        for (let i = 0; i < nI; i++, offset += 2) v.setInt16(offset, value(i, j, k, t), le)
      }
    }
  }
  return new Uint8Array(buffer)
}
