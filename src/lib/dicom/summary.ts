/**
 * The curated subset of header fields shown in the viewer's inspector.
 * Values are captured once per image at registration; empty fields are hidden.
 */
import type { DataSet } from 'dicom-parser'
import { valueForKeyword } from '@/lib/dicom/header'

type Format = 'date' | 'time' | 'person' | 'list' | 'sex' | 'age'

interface FieldSpec {
  label: string
  keyword: string
  format?: Format
  unit?: string
}

interface GroupSpec {
  title: string
  fields: FieldSpec[]
}

export const SUMMARY_GROUPS: GroupSpec[] = [
  {
    title: 'Patient',
    fields: [
      { label: 'Name', keyword: 'PatientName', format: 'person' },
      { label: 'ID', keyword: 'PatientID' },
      { label: 'Birth date', keyword: 'PatientBirthDate', format: 'date' },
      { label: 'Sex', keyword: 'PatientSex', format: 'sex' },
      { label: 'Age', keyword: 'PatientAge', format: 'age' },
      { label: 'Weight', keyword: 'PatientWeight', unit: 'kg' },
      { label: 'Size', keyword: 'PatientSize', unit: 'm' },
    ],
  },
  {
    title: 'Study',
    fields: [
      { label: 'Description', keyword: 'StudyDescription' },
      { label: 'Date', keyword: 'StudyDate', format: 'date' },
      { label: 'Time', keyword: 'StudyTime', format: 'time' },
      { label: 'Accession', keyword: 'AccessionNumber' },
      { label: 'Study ID', keyword: 'StudyID' },
      { label: 'Referring', keyword: 'ReferringPhysicianName', format: 'person' },
      { label: 'Institution', keyword: 'InstitutionName' },
      { label: 'Study UID', keyword: 'StudyInstanceUID' },
    ],
  },
  {
    title: 'Series',
    fields: [
      { label: 'Modality', keyword: 'Modality' },
      { label: 'Description', keyword: 'SeriesDescription' },
      { label: 'Number', keyword: 'SeriesNumber' },
      { label: 'Date', keyword: 'SeriesDate', format: 'date' },
      { label: 'Time', keyword: 'SeriesTime', format: 'time' },
      { label: 'Protocol', keyword: 'ProtocolName' },
      { label: 'Body part', keyword: 'BodyPartExamined' },
      { label: 'Position', keyword: 'PatientPosition' },
      { label: 'Series UID', keyword: 'SeriesInstanceUID' },
    ],
  },
  {
    title: 'Equipment',
    fields: [
      { label: 'Manufacturer', keyword: 'Manufacturer' },
      { label: 'Model', keyword: 'ManufacturerModelName' },
      { label: 'Station', keyword: 'StationName' },
      { label: 'Software', keyword: 'SoftwareVersions', format: 'list' },
      { label: 'Field strength', keyword: 'MagneticFieldStrength', unit: 'T' },
    ],
  },
  {
    title: 'Acquisition',
    fields: [
      { label: 'Sequence', keyword: 'SequenceName' },
      { label: 'Scanning seq.', keyword: 'ScanningSequence', format: 'list' },
      { label: 'Sequence variant', keyword: 'SequenceVariant', format: 'list' },
      { label: 'TR', keyword: 'RepetitionTime', unit: 'ms' },
      { label: 'TE', keyword: 'EchoTime', unit: 'ms' },
      { label: 'TI', keyword: 'InversionTime', unit: 'ms' },
      { label: 'Flip angle', keyword: 'FlipAngle', unit: '°' },
      { label: 'Echo train', keyword: 'EchoTrainLength' },
      { label: 'Averages', keyword: 'NumberOfAverages' },
      { label: 'kVp', keyword: 'KVP' },
      { label: 'Tube current', keyword: 'XRayTubeCurrent', unit: 'mA' },
      { label: 'Exposure', keyword: 'Exposure', unit: 'mAs' },
      { label: 'Kernel', keyword: 'ConvolutionKernel', format: 'list' },
      { label: 'Contrast', keyword: 'ContrastBolusAgent' },
      { label: 'Acq. date', keyword: 'AcquisitionDate', format: 'date' },
      { label: 'Acq. time', keyword: 'AcquisitionTime', format: 'time' },
    ],
  },
  {
    title: 'Image',
    fields: [
      { label: 'Instance', keyword: 'InstanceNumber' },
      { label: 'Image type', keyword: 'ImageType', format: 'list' },
      { label: 'Rows', keyword: 'Rows' },
      { label: 'Columns', keyword: 'Columns' },
      { label: 'Frames', keyword: 'NumberOfFrames' },
      { label: 'Pixel spacing', keyword: 'PixelSpacing', format: 'list', unit: 'mm' },
      { label: 'Slice thickness', keyword: 'SliceThickness', unit: 'mm' },
      { label: 'Slice spacing', keyword: 'SpacingBetweenSlices', unit: 'mm' },
      { label: 'Slice location', keyword: 'SliceLocation', unit: 'mm' },
      { label: 'Position', keyword: 'ImagePositionPatient', format: 'list' },
      { label: 'Orientation', keyword: 'ImageOrientationPatient', format: 'list' },
      { label: 'Photometric', keyword: 'PhotometricInterpretation' },
      { label: 'Bits stored', keyword: 'BitsStored' },
      { label: 'Pixel repr.', keyword: 'PixelRepresentation' },
      { label: 'Rescale', keyword: 'RescaleSlope' },
      { label: 'Intercept', keyword: 'RescaleIntercept' },
      { label: 'Window centre', keyword: 'WindowCenter', format: 'list' },
      { label: 'Window width', keyword: 'WindowWidth', format: 'list' },
      { label: 'SOP class', keyword: 'SOPClassUID' },
      { label: 'SOP instance', keyword: 'SOPInstanceUID' },
      { label: 'Transfer syntax', keyword: 'TransferSyntaxUID' },
    ],
  },
]

const ALL_KEYWORDS = SUMMARY_GROUPS.flatMap((g) => g.fields.map((f) => f.keyword))

/** Raw (unformatted) values of every curated keyword present in the dataset. */
export function extractSummary(ds: DataSet): Record<string, string> {
  const out: Record<string, string> = {}
  for (const keyword of ALL_KEYWORDS) {
    const value = valueForKeyword(ds, keyword)
    if (value) out[keyword] = value
  }
  return out
}

function formatDate(raw: string): string {
  return /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw
}

function formatTime(raw: string): string {
  const m = /^(\d{2})(\d{2})?(\d{2})?/.exec(raw)
  if (!m) return raw
  return [m[1], m[2], m[3]].filter(Boolean).join(':')
}

const SEX: Record<string, string> = { M: 'Male', F: 'Female', O: 'Other' }

const AGE_UNITS: Record<string, string> = { D: 'day', W: 'week', M: 'month', Y: 'year' }

/** A DICOM age string ("044Y") as words ("44 years"). */
function formatAge(raw: string): string {
  const m = /^(\d{3})([DWMY])$/.exec(raw.trim())
  if (!m) return raw
  const n = Number(m[1])
  return `${n} ${AGE_UNITS[m[2]]}${n === 1 ? '' : 's'}`
}

export function formatField(raw: string, format?: Format, unit?: string): string {
  let value = raw
  switch (format) {
    case 'date':
      value = formatDate(raw)
      break
    case 'time':
      value = formatTime(raw)
      break
    case 'person':
      value = raw.replace(/\^+/g, ' ').trim()
      break
    case 'list':
      value = raw.split('\\').map((v) => v.trim()).join(', ')
      break
    case 'sex':
      value = SEX[raw] ?? raw
      break
    case 'age':
      value = formatAge(raw)
      break
  }
  return unit ? `${value} ${unit}` : value
}
