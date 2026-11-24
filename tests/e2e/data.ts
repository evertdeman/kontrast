/** DICOM files generated for the end-to-end tests. */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gzipSync, zipSync } from 'fflate'
import { buildDicom, type DicomDataset } from '../../src/test/buildDicom'
import { buildNifti } from '../../src/test/buildNifti'

const CT_IMAGE_STORAGE = '1.2.840.10008.5.1.4.1.1.2'

export const SAMPLE_ZIP = path.resolve('public/sample.zip')

export function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'kontrast-e2e-'))
}

/** One small CT image whose identifiers are very long and whose names need UTF-8. */
export function longValuesFile(dir: string): string {
  const file = path.join(dir, 'IM0001.dcm')
  const dataset: DicomDataset = {
    '00080005': ['CS', 'ISO_IR 192'],
    '00080016': ['UI', CT_IMAGE_STORAGE],
    '00080018': ['UI', '1.2.826.0.1.3680043.99.777.1'],
    '00080020': ['DA', '20240131'],
    '00080050': ['SH', 'ACCESSION-NUMBER-THAT-GOES-ON-AND-ON-0123456789'],
    '00080060': ['CS', 'CT'],
    '00080080': ['LO', 'Universitätsklinikum-Department-Of-Neuroradiology-Building-7'],
    '00081030': ['LO', 'Long study'],
    '0008103E': ['LO', 'Axial_thin_slice_reconstruction_with_a_very_long_name_0123456789'],
    '00100010': ['PN', 'Verylongfamilynamewithoutanyspaces^Jürgen'],
    '00100020': ['LO', 'PATIENT-ID-0123456789-ABCDEFGHIJ-0123456789'],
    '0020000D': ['UI', '1.2.826.0.1.3680043.99.777'],
    '0020000E': ['UI', '1.2.826.0.1.3680043.99.777.2'],
    '00200010': ['SH', 'STUDYID0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'],
    ...imagePixels(64, () => 0),
  }
  writeFileSync(file, buildDicom(dataset))
  return file
}

/**
 * A zip of `count` uncompressed 512 × 512 CT slices. Each entry is over
 * 512 KB, which used to start one Web Worker per entry and crash the page.
 */
export function largeCtZip(dir: string, count: number): string {
  const entries: Record<string, Uint8Array> = {}
  for (let i = 0; i < count; i++) {
    entries[`study/IM${String(i).padStart(5, '0')}.dcm`] = buildDicom({
      '00080016': ['UI', CT_IMAGE_STORAGE],
      '00080018': ['UI', `1.2.826.0.1.3680043.99.${i + 1}`],
      '00080060': ['CS', 'CT'],
      '00081030': ['LO', 'Large zip'],
      '00100010': ['PN', 'Big^Zip'],
      '0020000D': ['UI', '1.2.826.0.1.3680043.99.1000'],
      '0020000E': ['UI', '1.2.826.0.1.3680043.99.2000'],
      '00200013': ['IS', String(i + 1)],
      '00200032': ['DS', `0\\0\\${i}`],
      '00200037': ['DS', '1\\0\\0\\0\\1\\0'],
      '00280030': ['DS', '0.5\\0.5'],
      ...imagePixels(512, (x, y) => (Math.hypot(x - 256, y - 256) < 200 ? 1000 + ((x * y + i) % 64) : 0)),
    })
  }
  const file = path.join(dir, 'large.zip')
  writeFileSync(file, zipSync(entries, { level: 1 }))
  return file
}

/**
 * A small axial CT head, for the CT-only viewer features (window presets and
 * Hounsfield statistics) that the MR sample study cannot exercise. A disk of
 * soft tissue (~40 HU) inside a thin bone ring (~1000 HU), on air.
 */
export function ctHeadZip(dir: string, count = 6): string {
  const studyUID = '1.2.826.0.1.3680043.99.555'
  const seriesUID = `${studyUID}.1`
  const entries: Record<string, Uint8Array> = {}
  for (let i = 0; i < count; i++) {
    entries[`ct/IM${String(i).padStart(4, '0')}.dcm`] = buildDicom({
      '00080016': ['UI', CT_IMAGE_STORAGE],
      '00080018': ['UI', `${seriesUID}.${i + 1}`],
      '00080020': ['DA', '20240201'],
      '00080060': ['CS', 'CT'],
      '00081030': ['LO', 'CT head'],
      '0008103E': ['LO', 'Axial'],
      '00100010': ['PN', 'Phantom^CT'],
      '00100020': ['LO', 'CT-FIXTURE'],
      '0020000D': ['UI', studyUID],
      '0020000E': ['UI', seriesUID],
      '00200011': ['IS', '1'],
      '00200013': ['IS', String(i + 1)],
      '00200032': ['DS', `-64\\-64\\${i * 5}`],
      '00200037': ['DS', '1\\0\\0\\0\\1\\0'],
      '00180050': ['DS', '5'],
      '00280030': ['DS', '1\\1'],
      '00281052': ['DS', '-1024'], // RescaleIntercept
      '00281053': ['DS', '1'], // RescaleSlope
      '00281054': ['LO', 'HU'], // RescaleType
      ...imagePixels(128, (x, y) => {
        const r = Math.hypot(x - 64, y - 64)
        if (r < 50) return 1064 // soft tissue, ~40 HU
        if (r < 56) return 2024 // bone ring, ~1000 HU
        return 0 // air
      }),
    })
  }
  const file = path.join(dir, 'ct-head.zip')
  writeFileSync(file, zipSync(entries, { level: 6 }))
  return file
}

/** An axial NIfTI volume (identity sform) with a bright disk on every slice. */
const brainNifti = () =>
  buildNifti({
    dims: [16, 16, 8],
    affine: [[1, 0, 0, -8], [0, 1, 0, -8], [0, 0, 1, 0]],
    value: (i, j) => (Math.hypot(i - 8, j - 8) < 16 / 3 ? 1000 : 0),
    calMax: 1000,
  })

/** A plain `.nii` volume on disk. */
export function niftiFile(dir: string): string {
  const file = path.join(dir, 'brain.nii')
  writeFileSync(file, brainNifti())
  return file
}

/** A gzip-compressed `.nii.gz` volume on disk, to exercise decompression. */
export function niftiGzFile(dir: string): string {
  const file = path.join(dir, 'brain.nii.gz')
  writeFileSync(file, gzipSync(brainNifti()))
  return file
}

/** A square 16-bit monochrome image, as dataset elements. */
function imagePixels(size: number, value: (x: number, y: number) => number): DicomDataset {
  const pixels = new Uint8Array(size * size * 2)
  const view = new DataView(pixels.buffer)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) view.setUint16((y * size + x) * 2, value(x, y), true)
  }
  return {
    '00280002': ['US', [1]],
    '00280004': ['CS', 'MONOCHROME2'],
    '00280010': ['US', [size]],
    '00280011': ['US', [size]],
    '00280100': ['US', [16]],
    '00280101': ['US', [12]],
    '00280102': ['US', [11]],
    '00280103': ['US', [0]],
    '7FE00010': ['OW', pixels],
  }
}
