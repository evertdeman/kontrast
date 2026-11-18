/**
 * Header anonymisation following the DICOM Basic Application Level
 * Confidentiality Profile (PS3.15 Annex E), with optional parts of its
 * "Retain Longitudinal Temporal Information" and "Retain Patient
 * Characteristics" options.
 *
 * The profile's attribute table drives most decisions. Attributes it does not
 * list are kept only if they are known to the DICOM dictionary and are not free
 * text, a person name, an address or a URL. Pixel data is never changed, so
 * text burned into the image stays.
 */
import dcmjs, { type DicomDataset, type DicomElement } from 'dcmjs'
import { BASIC_PROFILE, type ProfileAction } from '@/lib/dicom/basicProfile'

const { DicomDict, DicomMessage, DicomMetaDictionary } = dcmjs.data

export interface AnonymizeOptions {
  /**
   * What to do with dates and times: remove them, move every date by the
   * same random number of days (keeping intervals and the patient's age at
   * each study), or keep them as they are. Times are only removed with dates.
   */
  dates: 'remove' | 'shift' | 'keep'
  keepAge: boolean
  keepSex: boolean
  keepSizeAndWeight: boolean
  /** Days to move dates by when shifting; random (±1 to 365) if omitted. */
  dateOffsetDays?: number
}

export const DEFAULT_OPTIONS: AnonymizeOptions = {
  dates: 'remove',
  keepAge: false,
  keepSex: false,
  keepSizeAndWeight: false,
}

const PATIENT_NAME = '00100010'
const PATIENT_ID = '00100020'
const PATIENT_AGE = '00101010'
const PATIENT_SEX = '00100040'
const PATIENT_SIZE = '00101020'
const PATIENT_WEIGHT = '00101030'
const SOP_INSTANCE_UID = '00080018'
const LONG_CODE_VALUE = '00080119'
const MEDIA_STORAGE_SOP_INSTANCE_UID = '00020003'
const TRANSFER_SYNTAX_UID = '00020010'
const DEFLATED_EXPLICIT_LITTLE_ENDIAN = '1.2.840.10008.1.2.1.99'
const EXPLICIT_LITTLE_ENDIAN = '1.2.840.10008.1.2.1'
/** File meta elements naming the sending and receiving systems. */
const META_REMOVE = ['00020016', '00020017', '00020018', '00020100', '00020102']

/** Identifying attributes missing from the profile table. */
const EXTRA_ACTIONS = new Map<string, ProfileAction>([
  ['00100033', 'X'], // Patient's Birth Date in Alternative Calendar
  ['00100034', 'X'], // Patient's Death Date in Alternative Calendar
  ['00100035', 'X'], // Patient's Alternative Calendar
])

/** UIDs that name a standard or a SOP class rather than an instance. */
const KEEP_UID_TAGS = new Set([
  '00020002', // Media Storage SOP Class UID
  '00020010', // Transfer Syntax UID
  '00020012', // Implementation Class UID
  '00080016', // SOP Class UID
  '00080062', // SOP Classes in Study
  '0008010C', // Coding Scheme UID
  '00081150', // Referenced SOP Class UID
  '0008001A', // Related General SOP Class UID
  '0008001B', // Original Specialized SOP Class UID
])
const WELL_KNOWN_UID_PREFIX = '1.2.840.10008.'

/** Free text, addresses, URLs and elements of unknown type: always removed. */
const REMOVE_VRS = new Set(['LT', 'ST', 'UT', 'UC', 'AE', 'UN', 'UR'])
/** Dates and times, handled according to `AnonymizeOptions.dates`. */
const TEMPORAL_VRS = new Set(['DA', 'DT', 'TM'])

/** Codes for the de-identification method (CID 7050). */
const METHODS = {
  basic: ['113100', 'Basic Application Confidentiality Profile'],
  fullDates: ['113106', 'Retain Longitudinal Temporal Information Full Dates Option'],
  modifiedDates: ['113107', 'Retain Longitudinal Temporal Information Modified Dates Option'],
  patientCharacteristics: ['113108', 'Retain Patient Characteristics Option'],
} as const

/** A fresh UID under the UUID-derived root 2.25 (PS3.5 B.2). */
export function randomUid(): string {
  return `2.25.${BigInt(`0x${randomHex(16)}`)}`
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
}

function randomOffsetDays(): number {
  const [n] = crypto.getRandomValues(new Uint32Array(1))
  const days = (n % 365) + 1
  return n & 0x80000000 ? -days : days
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Move a YYYYMMDD date by whole days; null if it is not a valid date. */
export function shiftDate(date: string, days: number): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(date.trim())
  if (!match) return null
  const [year, month, day] = match.slice(1).map(Number)
  const original = new Date(Date.UTC(year, month - 1, day))
  if (original.getUTCMonth() !== month - 1 || original.getUTCDate() !== day) return null
  const shifted = new Date(original.getTime() + days * DAY_MS)
  return [
    String(shifted.getUTCFullYear()).padStart(4, '0'),
    String(shifted.getUTCMonth() + 1).padStart(2, '0'),
    String(shifted.getUTCDate()).padStart(2, '0'),
  ].join('')
}

/** Move the date part of a DT value, keeping its time and UTC offset. */
function shiftDateTime(value: string, days: number): string | null {
  const trimmed = value.trim()
  const date = shiftDate(trimmed.slice(0, 8), days)
  return date && date + trimmed.slice(8)
}

function element(vr: string, Value: unknown[]): DicomElement {
  return { vr, Value }
}

function isPrivate(tag: string): boolean {
  return parseInt(tag.slice(0, 4), 16) % 2 === 1
}

/** Curves (50xx) and overlays (60xx), which can hold drawn-on text. */
function isCurveOrOverlay(tag: string): boolean {
  return tag.startsWith('50') || tag.startsWith('60')
}

function isKnownTag(tag: string): boolean {
  return !!DicomMetaDictionary.dictionary[`(${tag.slice(0, 4)},${tag.slice(4)})`]
}

export interface Anonymizer {
  /** Anonymise one Part 10 file. Throws if it cannot be parsed. */
  anonymize(file: ArrayBuffer): ArrayBuffer
}

/**
 * Create an anonymiser for one export. UIDs, patient IDs and the date offset
 * are the same for every file it processes, so the output still groups into
 * the same patients, studies and series, references between instances still
 * resolve, and intervals between dates are kept.
 */
export function createAnonymizer(options: Partial<AnonymizeOptions> = {}): Anonymizer {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const offset = opts.dateOffsetDays ?? randomOffsetDays()
  const keep = new Set([
    ...(opts.keepAge ? [PATIENT_AGE] : []),
    ...(opts.keepSex ? [PATIENT_SEX] : []),
    ...(opts.keepSizeAndWeight ? [PATIENT_SIZE, PATIENT_WEIGHT] : []),
  ])

  const uids = new Map<string, string>()
  const patientIds = new Map<string, string>()

  const mapUid = (value: unknown) => {
    const uid = String(value).replace(/[\0\s]+$/, '').trim()
    if (!uid || uid.startsWith(WELL_KNOWN_UID_PREFIX)) return uid
    let mapped = uids.get(uid)
    if (!mapped) {
      mapped = randomUid()
      uids.set(uid, mapped)
    }
    return mapped
  }

  const pseudonymFor = (dataset: DicomDataset) => {
    const original = String(dataset[PATIENT_ID]?.Value?.[0] ?? '').trim()
    let mapped = patientIds.get(original)
    if (!mapped) {
      mapped = `ANON-${randomHex(4).toUpperCase()}`
      patientIds.set(original, mapped)
    }
    return mapped
  }

  const temporal = (el: DicomElement): DicomElement => {
    if (opts.dates === 'keep') return el
    if (opts.dates === 'remove') return element(el.vr, [])
    if (el.vr === 'TM') return el
    const shift = el.vr === 'DA' ? shiftDate : shiftDateTime
    const values = (el.Value ?? [])
      .map((v) => shift(String(v), offset))
      .filter((v): v is string => v !== null)
    return element(el.vr, values)
  }

  /** Apply the profile to one element; undefined means remove it. */
  function process(tag: string, el: DicomElement): DicomElement | undefined {
    if (isPrivate(tag) || isCurveOrOverlay(tag)) return undefined
    if (keep.has(tag)) return el
    if (TEMPORAL_VRS.has(el.vr)) return temporal(el)

    const action = BASIC_PROFILE.get(tag) ?? EXTRA_ACTIONS.get(tag)
    if (action === 'X') return undefined
    if (action === 'U' || el.vr === 'UI') {
      return KEEP_UID_TAGS.has(tag) ? el : element(el.vr, (el.Value ?? []).map(mapUid))
    }
    if (action === 'X/Z/U*' || (!action && el.vr === 'SQ')) {
      for (const item of (el.Value ?? []) as DicomDataset[]) clean(item)
      return el
    }
    // Every other action allows an empty value; an empty sequence has no items.
    if (action) return element(el.vr, [])

    if (!isKnownTag(tag)) return undefined
    if (REMOVE_VRS.has(el.vr) && tag !== LONG_CODE_VALUE) return undefined
    if (el.vr === 'PN') return element(el.vr, [])
    return el
  }

  function clean(dataset: DicomDataset) {
    for (const [tag, el] of Object.entries(dataset)) {
      const result = process(tag, el)
      if (result) dataset[tag] = result
      else delete dataset[tag]
    }
  }

  const methods = [
    METHODS.basic,
    ...(opts.dates === 'shift' ? [METHODS.modifiedDates] : []),
    ...(opts.dates === 'keep' ? [METHODS.fullDates] : []),
    ...(keep.size > 0 ? [METHODS.patientCharacteristics] : []),
  ]
  const temporalStatus = { remove: 'REMOVED', shift: 'MODIFIED', keep: 'UNMODIFIED' }[opts.dates]

  return {
    anonymize(file) {
      const { meta, dict } = DicomMessage.readFile(file)
      const pseudonym = pseudonymFor(dict)

      clean(dict)
      dict[PATIENT_NAME] = element('PN', [{ Alphabetic: pseudonym }])
      dict[PATIENT_ID] = element('LO', [pseudonym])
      dict['00120062'] = element('CS', ['YES']) // Patient Identity Removed
      dict['00120063'] = element('LO', methods.map(([, meaning]) => meaning)) // De-identification Method
      dict['00120064'] = element(
        'SQ',
        methods.map(([code, meaning]) => ({
          '00080100': element('SH', [code]),
          '00080102': element('SH', ['DCM']),
          '00080104': element('LO', [meaning]),
        })),
      )
      dict['00280303'] = element('CS', [temporalStatus]) // Longitudinal Temporal Information Modified

      for (const tag of META_REMOVE) delete meta[tag]
      const sopInstanceUid = dict[SOP_INSTANCE_UID]?.Value?.[0]
      const mediaUid = meta[MEDIA_STORAGE_SOP_INSTANCE_UID]?.Value?.[0]
      if (sopInstanceUid || mediaUid) {
        meta[MEDIA_STORAGE_SOP_INSTANCE_UID] = element('UI', [sopInstanceUid ?? mapUid(mediaUid)])
      }
      // dcmjs inflates deflated datasets on read but cannot deflate on write.
      if (meta[TRANSFER_SYNTAX_UID]?.Value?.[0] === DEFLATED_EXPLICIT_LITTLE_ENDIAN) {
        meta[TRANSFER_SYNTAX_UID] = element('UI', [EXPLICIT_LITTLE_ENDIAN])
      }

      const out = new DicomDict(meta)
      out.dict = dict
      return out.write()
    },
  }
}

/** The header fields `mayHaveBurnedInText` looks at. */
export interface BurnedInHints {
  modality: string
  sopClassUID: string
  burnedInAnnotation: string
}

/** Modalities whose images routinely carry on-screen text. */
const TEXT_PRONE_MODALITIES = new Set(['US', 'XC', 'ES', 'OT', 'DOC', 'SM'])
const SECONDARY_CAPTURE_PREFIX = '1.2.840.10008.5.1.4.1.1.7'

/**
 * Whether an image may show identifying text in its pixels, which header
 * anonymisation does not touch. An explicit BurnedInAnnotation wins;
 * otherwise screenshots and text-prone modalities are flagged.
 */
export function mayHaveBurnedInText({
  modality,
  sopClassUID,
  burnedInAnnotation,
}: BurnedInHints): boolean {
  const declared = burnedInAnnotation.trim().toUpperCase()
  if (declared === 'YES') return true
  if (declared === 'NO') return false
  return (
    TEXT_PRONE_MODALITIES.has(modality.toUpperCase()) ||
    sopClassUID.startsWith(SECONDARY_CAPTURE_PREFIX)
  )
}
