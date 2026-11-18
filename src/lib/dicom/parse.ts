/**
 * Pure DICOM parsing for indexing: which files to read, why a file is
 * skipped, and the header tags used for grouping and display. No Cornerstone
 * dependency, so it can be unit-tested.
 */
import dicomParser from 'dicom-parser'
import { extractSummary } from '@/lib/dicom/summary'
import { parseDecimals } from '@/lib/dicom/geometry'

export interface DicomTags {
  studyUID: string
  seriesUID: string
  sopUID: string
  sopClassUID: string
  modality: string
  studyDescription: string
  seriesDescription: string
  studyDate: string
  patientName: string
  patientId: string
  patientSex: string
  seriesNumber: number | null
  instanceNumber: number | null
  rows: number | null
  columns: number | null
  numberOfFrames: number
  /** ImageOrientationPatient (row then column cosines), if known. */
  imageOrientation: number[] | null
  /** ImagePositionPatient, if known. */
  imagePosition: number[] | null
  /** PatientOrientation (row and column direction), for projection images. */
  patientOrientation: [string, string] | null
  accession: string
  /** BurnedInAnnotation: "YES", "NO" or empty when absent. */
  burnedInAnnotation: string
  /** Curated header values keyed by DICOM keyword, for the inspector. */
  summary: Record<string, string>
}

export type SkipReason = 'notDicom' | 'noImage' | 'unsupported' | 'badArchive' | 'duplicate'

const DICOM_EXT = /\.(dcm|dicom|ima|img)$/i

/**
 * Cheap pre-filter before reading a whole file. DICOM files often have no
 * extension, or a numeric one when named by UID ("1.2.840.113619.2.55");
 * anything else is accepted only if it carries the "DICM" magic at byte 128.
 */
export async function looksLikeDicom(file: File): Promise<boolean> {
  if (DICOM_EXT.test(file.name)) return true
  if (!/\.[^.]*[a-z][^.]*$/i.test(file.name)) return true
  const magic = new Uint8Array(await file.slice(128, 132).arrayBuffer())
  return String.fromCharCode(...magic) === 'DICM'
}

function pn(raw?: string): string {
  // DICOM PersonName: "Family^Given^Middle^Prefix^Suffix"
  return raw ? raw.replace(/\^+/g, ' ').trim() : ''
}

function num(raw?: string): number | null {
  if (raw === undefined || raw === '') return null
  const n = Number(raw)
  return Number.isNaN(n) ? null : n
}

/** Transfer syntaxes the bundled Cornerstone decoders can handle. */
const SUPPORTED_TRANSFER_SYNTAXES = new Set([
  '1.2.840.10008.1.2', // Implicit VR Little Endian
  '1.2.840.10008.1.2.1', // Explicit VR Little Endian
  '1.2.840.10008.1.2.1.98', // Encapsulated Uncompressed
  '1.2.840.10008.1.2.1.99', // Deflated Explicit VR Little Endian
  '1.2.840.10008.1.2.2', // Explicit VR Big Endian
  '1.2.840.10008.1.2.4.50', // JPEG Baseline
  '1.2.840.10008.1.2.4.51', // JPEG Extended
  '1.2.840.10008.1.2.4.53',
  '1.2.840.10008.1.2.4.55',
  '1.2.840.10008.1.2.4.57', // JPEG Lossless
  '1.2.840.10008.1.2.4.70', // JPEG Lossless SV1
  '1.2.840.10008.1.2.4.80', // JPEG-LS Lossless
  '1.2.840.10008.1.2.4.81', // JPEG-LS Near-lossless
  '1.2.840.10008.1.2.4.90', // JPEG 2000 Lossless
  '1.2.840.10008.1.2.4.91', // JPEG 2000
  '1.2.840.10008.1.2.4.110', // JPEG XL
  '1.2.840.10008.1.2.4.111',
  '1.2.840.10008.1.2.4.112',
  '1.2.840.10008.1.2.4.201', // HTJ2K
  '1.2.840.10008.1.2.4.202',
  '1.2.840.10008.1.2.4.203',
  '1.2.840.10008.1.2.5', // RLE Lossless
])

const PIXEL_DATA_TAGS = ['x7fe00010', 'x7fe00008', 'x7fe00009']

export class SkipError extends Error {
  readonly reason: SkipReason
  constructor(reason: SkipReason) {
    super(reason)
    this.reason = reason
  }
}

type DataSet = ReturnType<typeof dicomParser.parseDicom>

/**
 * Read a plane tag from the top level, or for enhanced multi-frame objects
 * from the shared or first per-frame functional group.
 */
function planeTag(ds: DataSet, tag: string, sequence: string): string | undefined {
  const top = ds.string(tag)
  if (top) return top
  for (const groups of ['x52009229', 'x52009230']) {
    const item = ds.elements[groups]?.items?.[0]?.dataSet
    const value = item?.elements[sequence]?.items?.[0]?.dataSet?.string(tag)
    if (value) return value
  }
  return undefined
}

function patientOrientation(ds: DataSet): [string, string] | null {
  const parts = (ds.string('x00200020') ?? '').split('\\').map((s) => s.trim())
  return parts.length === 2 && parts[0] && parts[1] ? [parts[0], parts[1]] : null
}

export function parseTags(bytes: Uint8Array): DicomTags {
  let ds: DataSet
  try {
    ds = dicomParser.parseDicom(bytes)
  } catch {
    throw new SkipError('notDicom')
  }
  const transferSyntax = ds.string('x00020010')
  if (transferSyntax && !SUPPORTED_TRANSFER_SYNTAXES.has(transferSyntax)) {
    throw new SkipError('unsupported')
  }
  if (!PIXEL_DATA_TAGS.some((tag) => ds.elements[tag])) {
    throw new SkipError('noImage')
  }
  return {
    studyUID: ds.string('x0020000d') ?? '',
    seriesUID: ds.string('x0020000e') ?? '',
    sopUID: ds.string('x00080018') ?? '',
    sopClassUID: ds.string('x00080016') ?? '',
    modality: ds.string('x00080060') ?? '',
    studyDescription: ds.string('x00081030') ?? '',
    seriesDescription: ds.string('x0008103e') ?? '',
    studyDate: ds.string('x00080020') ?? '',
    patientName: pn(ds.string('x00100010')),
    patientId: ds.string('x00100020') ?? '',
    patientSex: ds.string('x00100040') ?? '',
    seriesNumber: num(ds.string('x00200011')),
    instanceNumber: num(ds.string('x00200013')),
    rows: ds.uint16('x00280010') ?? null,
    columns: ds.uint16('x00280011') ?? null,
    numberOfFrames: Math.max(1, num(ds.string('x00280008')) ?? 1),
    imageOrientation: parseDecimals(planeTag(ds, 'x00200037', 'x00209116'), 6),
    imagePosition: parseDecimals(planeTag(ds, 'x00200032', 'x00209113'), 3),
    patientOrientation: patientOrientation(ds),
    accession: ds.string('x00080050') ?? '',
    burnedInAnnotation: ds.string('x00280301') ?? '',
    summary: extractSummary(ds),
  }
}

/** One imageId per frame for multi-frame files; frame numbers are 1-based. */
export function frameImageIds(baseImageId: string, numberOfFrames: number): string[] {
  return numberOfFrames > 1
    ? Array.from({ length: numberOfFrames }, (_, i) => `${baseImageId}?frame=${i + 1}`)
    : [baseImageId]
}

export function emptySkipCounts(): Record<SkipReason, number> {
  return { notDicom: 0, noImage: 0, unsupported: 0, badArchive: 0, duplicate: 0 }
}

const SKIP_LABELS: Record<SkipReason, [string, string]> = {
  notDicom: ['not DICOM', 'not DICOM'],
  noImage: ['has no image (report, PDF or other non-image object)', 'have no image (reports, PDFs or other non-image objects)'],
  unsupported: ['uses an unsupported compression (e.g. video)', 'use an unsupported compression (e.g. video)'],
  badArchive: ['is a zip that could not be opened (damaged or encrypted)', 'are zips that could not be opened (damaged or encrypted)'],
  duplicate: ['was already open', 'were already open'],
}

/** Human-readable summary of skipped files, or null if none were skipped. */
export function describeSkipped(skipped: Record<SkipReason, number>): string | null {
  const parts = (Object.keys(SKIP_LABELS) as SkipReason[])
    .filter((reason) => skipped[reason] > 0)
    .map((reason) => {
      const n = skipped[reason]
      return `${n} ${SKIP_LABELS[reason][n === 1 ? 0 : 1]}`
    })
  if (parts.length === 0) return null
  const total = Object.values(skipped).reduce((a, b) => a + b, 0)
  return `Skipped ${total} file${total === 1 ? '' : 's'}: ${parts.join('; ')}.`
}
