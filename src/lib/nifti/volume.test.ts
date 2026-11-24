import { gzipSync } from 'fflate'
import { describe, expect, test } from 'vitest'
import { buildNifti, type NiftiOptions } from '@/test/buildNifti'
import { SkipError } from '@/lib/dicom/parse'
import { niftiLayout, readNiftiHeader, readNiftiPixels, slicePosition } from '@/lib/nifti/volume'

const blob = (bytes: Uint8Array) => new Blob([bytes as Uint8Array<ArrayBuffer>])

async function open(options: NiftiOptions, gzip = false) {
  const bytes = buildNifti(options)
  const file = blob(gzip ? gzipSync(bytes) : bytes)
  const header = (await readNiftiHeader(file))!
  const layout = niftiLayout(header)
  return { header, layout, pixels: await readNiftiPixels(file, header, layout) }
}

/** The displayed pixel at row r, column c of slice k. */
function pixel({ layout, pixels }: Awaited<ReturnType<typeof open>>, k: number, r: number, c: number) {
  return pixels.data[(k * layout.rows + r) * layout.columns + c]
}

describe('readNiftiHeader', () => {
  test('reads plain and gzipped files alike', async () => {
    const bytes = buildNifti({ dims: [4, 3, 2] })
    for (const file of [blob(bytes), blob(gzipSync(bytes))]) {
      expect((await readNiftiHeader(file))?.dims.slice(0, 4)).toEqual([3, 4, 3, 2])
    }
  })

  test('returns null for other files', async () => {
    expect(await readNiftiHeader(blob(new Uint8Array(600)))).toBeNull()
    expect(await readNiftiHeader(blob(new Uint8Array(10)))).toBeNull()
  })
})

describe('niftiLayout', () => {
  test('shows an RAS axial volume anterior up, patient left on the right', async () => {
    // i runs to the patient's right, j to anterior: storage order would be upside down.
    const volume = await open({ dims: [3, 2, 1], value: (i, j) => 10 * j + i })
    expect(volume.layout.rowCosines).toEqual([1, 0, 0])
    expect(volume.layout.columnCosines).toEqual([0, 1, 0])
    // Top-left is the most anterior, most right voxel.
    expect(pixel(volume, 0, 0, 0)).toBe(12)
    expect(pixel(volume, 0, 1, 2)).toBe(0)
  })

  test('shows a sagittal volume anterior left, superior up', async () => {
    // i runs posterior to anterior, j inferior to superior, slices right to left.
    const volume = await open({
      dims: [3, 2, 4],
      affine: [[0, 0, -2, 10], [1, 0, 0, 0], [0, 1, 0, 0]],
      value: (i, j) => 10 * j + i,
    })
    expect(volume.layout.rowCosines).toEqual([0, 1, 0])
    expect(volume.layout.columnCosines).toEqual([0, 0, -1])
    expect(volume.layout.sliceSpacing).toBe(2)
    expect(slicePosition(volume.layout, 1)).toEqual([-8, -2, 1])
    expect(pixel(volume, 0, 0, 0)).toBe(12)
  })

  test('swaps rows and columns when i runs foot to head', async () => {
    // Coronal slices with i along the patient's long axis.
    const { layout } = await open({ dims: [5, 3, 1], affine: [[0, 1, 0, 0], [0, 0, 1, 0], [1, 0, 0, 0]] })
    expect([layout.columns, layout.rows]).toEqual([3, 5])
    expect(layout.rowCosines).toEqual([1, 0, 0])
    expect(layout.columnCosines).toEqual([0, 0, -1])
  })

  test('skips voxel types it cannot show', async () => {
    const header = (await readNiftiHeader(blob(buildNifti({ dims: [2, 2, 1], datatype: 128, bitpix: 24 }))))!
    expect(() => niftiLayout(header)).toThrow(SkipError)
  })
})

describe('readNiftiPixels', () => {
  test('applies the intensity scaling and windows to the display range', async () => {
    const { pixels } = await open({ dims: [2, 1, 1], value: (i) => i, slope: 2, intercept: -1, calMax: 100 })
    expect([...pixels.data].sort()).toEqual([-1, 1])
    expect([pixels.windowCenter, pixels.windowWidth]).toEqual([50, 100])
  })

  test('windows to the data range without a display range', async () => {
    const { pixels } = await open({ dims: [2, 1, 1], value: (i) => 100 + 50 * i })
    expect([pixels.min, pixels.max, pixels.windowCenter, pixels.windowWidth]).toEqual([100, 150, 125, 50])
  })

  test('reads big-endian and gzipped voxels', async () => {
    const value = (i: number) => 300 + i
    const { pixels } = await open({ dims: [2, 1, 1], value, littleEndian: false }, true)
    expect([...pixels.data].sort()).toEqual([300, 301])
  })

  test('shows the first volume of a 4D file', async () => {
    const { layout, pixels } = await open({ dims: [1, 1, 2, 3], value: (_i, _j, k, t) => 10 * t + k })
    expect(layout.volumes).toBe(3)
    expect([...pixels.data]).toEqual([0, 1])
  })

  test('rejects a truncated file', async () => {
    const bytes = buildNifti({ dims: [4, 4, 4] })
    const file = blob(bytes.subarray(0, 400))
    const header = (await readNiftiHeader(file))!
    await expect(readNiftiPixels(file, header, niftiLayout(header))).rejects.toThrow(/truncated/)
  })
})
