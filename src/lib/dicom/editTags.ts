/**
 * Edit DICOM header elements to make test data. Unlike the anonymiser, this
 * writes whatever it is told to, including values that break the standard:
 * invalid data is often the point.
 */
import dcmjs, { type DicomDataset, type DicomElement } from 'dcmjs'
import { createUidMapper, isInstanceUidTag } from '@/lib/dicom/anonymize'

const { DicomDict, DicomMessage, DicomMetaDictionary } = dcmjs.data

export interface ResolvedTag {
  /** "GGGGEEEE", upper-case hex. */
  tag: string
  keyword: string
  vr: string
}

export interface TagEdit {
  tag: ResolvedTag
  action: 'set' | 'remove'
  /** Multiple values are separated by backslashes; ignored when removing. */
  value: string
  /** Series to apply the edit to, by SeriesInstanceUID; null for the whole study. */
  seriesUID: string | null
}

export interface EditOptions {
  /** Give every study, series and instance a new UID, consistently across files. */
  newUids: boolean
}

export interface Issue {
  /** Errors stop the export; warnings only flag values that break the standard. */
  level: 'error' | 'warning'
  message: string
}

/** Binary numbers, which cannot hold a value that is not a number. */
const NUMERIC: Record<string, { min: number; max: number; integer: boolean }> = {
  US: { min: 0, max: 0xffff, integer: true },
  SS: { min: -0x8000, max: 0x7fff, integer: true },
  UL: { min: 0, max: 0xffffffff, integer: true },
  SL: { min: -0x80000000, max: 0x7fffffff, integer: true },
  FL: { min: -3.4e38, max: 3.4e38, integer: false },
  FD: { min: -Number.MAX_VALUE, max: Number.MAX_VALUE, integer: false },
}

/** Maximum length of one value, per VR (PS3.5 6.2). */
const MAX_LENGTH: Record<string, number> = {
  AE: 16, AS: 4, CS: 16, DA: 8, DS: 16, IS: 12, LO: 64, PN: 64, SH: 16,
  ST: 1024, LT: 10240, TM: 14, UI: 64, DT: 26, UC: 0xfffffffe, UT: 0xfffffffe,
}

const FORMATS: Record<string, [RegExp, string]> = {
  DA: [/^\d{8}$/, 'a date as YYYYMMDD'],
  TM: [/^\d{2}(\d{2}(\d{2}(\.\d{1,6})?)?)?$/, 'a time as HHMMSS'],
  DT: [/^\d{4}(\d{2}(\d{2}(\d{2}(\d{2}(\d{2}(\.\d{1,6})?)?)?)?)?)?([+-]\d{4})?$/, 'a date and time as YYYYMMDDHHMMSS'],
  UI: [/^[0-9]+(\.[0-9]+)*$/, 'digits separated by dots'],
  AS: [/^\d{3}[DWMY]$/, 'an age such as 044Y'],
  CS: [/^[A-Z0-9 _]*$/, 'upper-case letters, digits, spaces and underscores'],
  IS: [/^\s*[+-]?\d+\s*$/, 'a whole number'],
  DS: [/^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/, 'a decimal number'],
}

/** Value representations that can't be typed in: sequences, binary data and tags. */
const NOT_EDITABLE_VRS = new Set(['SQ', 'OB', 'OW', 'OF', 'OD', 'OL', 'OV', 'UN', 'AT'])

/** Find a tag by keyword ("PatientName") or number ("(0010,0010)", "00100010"). */
export function resolveTag(input: string): ResolvedTag | null {
  const text = input.trim()
  const hex = text.replace(/[(),\s]/g, '').toUpperCase()
  const entry = /^[0-9A-F]{8}$/.test(hex)
    ? DicomMetaDictionary.dictionary[`(${hex.slice(0, 4)},${hex.slice(4)})`]
    : DicomMetaDictionary.nameMap[text]
  if (!entry) return null
  const tag = entry.tag.replace(/[(),]/g, '').toUpperCase()
  // Repeating groups such as (60xx,3000) don't name one element.
  if (!/^[0-9A-F]{8}$/.test(tag)) return null
  // "xs" is US or SS depending on the image, "ox" is OB or OW.
  const vr = { xs: 'US', ox: 'OW' }[entry.vr] ?? entry.vr
  return { tag, keyword: entry.name, vr }
}

/** Every keyword in the dictionary, for autocompletion. */
export function allKeywords(): string[] {
  return Object.keys(DicomMetaDictionary.nameMap)
    .filter((k) => !k.startsWith('RETIRED_'))
    .sort()
}

/** Why a tag can't be edited, or null if it can. */
export function notEditableReason(tag: ResolvedTag): string | null {
  if (tag.tag.startsWith('0002')) return 'File meta information can’t be edited; changing it makes files unreadable.'
  if (tag.tag.startsWith('7FE0')) return 'Pixel data can’t be edited.'
  if (tag.tag.endsWith('0000')) return 'Group lengths are worked out when the file is written.'
  if (NOT_EDITABLE_VRS.has(tag.vr)) return `${tag.keyword} holds ${tag.vr === 'SQ' ? 'a sequence' : 'binary data'}, which can’t be typed in.`
  return null
}

/** Problems with an edit: errors block it, warnings flag values that break the standard. */
export function checkEdit(edit: TagEdit): Issue[] {
  const reason = notEditableReason(edit.tag)
  if (reason) return [{ level: 'error', message: reason }]
  if (edit.action === 'remove' || edit.value === '') return []

  const { vr } = edit.tag
  const values = edit.value.split('\\')
  const numeric = NUMERIC[vr]
  if (numeric) {
    const bad = values.find((v) => {
      const n = Number(v)
      return v.trim() === '' || !Number.isFinite(n) || n < numeric.min || n > numeric.max ||
        (numeric.integer && !Number.isInteger(n))
    })
    return bad === undefined
      ? []
      : [{ level: 'error', message: `“${bad}” doesn’t fit a ${vr} (a binary number from ${numeric.min} to ${numeric.max}).` }]
  }

  const issues: Issue[] = []
  const format = FORMATS[vr]
  const badFormat = format ? values.find((v) => !format[0].test(v)) : undefined
  if (format && badFormat !== undefined) {
    issues.push({ level: 'warning', message: `“${badFormat}” isn’t ${format[1]}, as ${vr} requires.` })
  }
  const max = MAX_LENGTH[vr]
  const tooLong = max && values.find((v) => v.length > max)
  if (tooLong) {
    issues.push({ level: 'warning', message: `A ${vr} value may be at most ${max} characters; this one has ${tooLong.length}.` })
  }
  return issues
}

/** `vr` is the element's VR in the file when it exists, which can differ from the dictionary's. */
function toElement(vr: string, value: string): DicomElement {
  if (value === '') return { vr, Value: [] }
  const values = vr === 'LT' || vr === 'ST' || vr === 'UT' ? [value] : value.split('\\')
  if (NUMERIC[vr]) return { vr, Value: values.map(Number) }
  if (vr === 'PN') return { vr, Value: values.map((v) => ({ Alphabetic: v })) }
  return { vr, Value: values }
}

function remapUids(dataset: DicomDataset, mapUid: (uid: unknown) => string) {
  for (const [tag, el] of Object.entries(dataset)) {
    if (el.vr === 'UI' && isInstanceUidTag(tag)) {
      dataset[tag] = { vr: 'UI', Value: (el.Value ?? []).map(mapUid) }
    } else if (el.vr === 'SQ') {
      for (const item of (el.Value ?? []) as DicomDataset[]) remapUids(item, mapUid)
    }
  }
}

/** Whether any text in the dataset needs more than ASCII. */
function hasNonAscii(dataset: DicomDataset): boolean {
  return Object.values(dataset).some((el) =>
    (el.Value ?? []).some((v) => {
      if (typeof v === 'string') return /[^\x20-\x7e]/.test(v)
      if (el.vr === 'PN' && v && typeof v === 'object') {
        return Object.values(v).some((s) => typeof s === 'string' && /[^\x20-\x7e]/.test(s))
      }
      if (el.vr === 'SQ' && v && typeof v === 'object') return hasNonAscii(v as DicomDataset)
      return false
    }),
  )
}

const SPECIFIC_CHARACTER_SET = '00080005'
const SOP_INSTANCE_UID = '00080018'
const MEDIA_STORAGE_SOP_INSTANCE_UID = '00020003'

export interface TagEditor {
  /** Apply the edits that cover `seriesUID` to one Part 10 file. */
  edit(file: ArrayBuffer, seriesUID: string): ArrayBuffer
}

/** One editor per export, so new UIDs stay consistent across its files. */
export function createTagEditor(edits: TagEdit[], { newUids }: EditOptions): TagEditor {
  const mapUid = createUidMapper()
  return {
    edit(file, seriesUID) {
      const { meta, dict } = DicomMessage.readFile(file)
      if (newUids) remapUids(dict, mapUid)

      for (const edit of edits) {
        if (edit.seriesUID !== null && edit.seriesUID !== seriesUID) continue
        if (edit.action === 'remove') delete dict[edit.tag.tag]
        else dict[edit.tag.tag] = toElement(dict[edit.tag.tag]?.vr ?? edit.tag.vr, edit.value)
      }

      // dcmjs writes text as UTF-8, so say so unless the edits chose a character set.
      const setsCharset = edits.some((e) => e.tag.tag === SPECIFIC_CHARACTER_SET)
      if (!setsCharset && hasNonAscii(dict)) {
        dict[SPECIFIC_CHARACTER_SET] = { vr: 'CS', Value: ['ISO_IR 192'] }
      }
      const sopInstanceUid = dict[SOP_INSTANCE_UID]?.Value?.[0]
      if (sopInstanceUid) meta[MEDIA_STORAGE_SOP_INSTANCE_UID] = { vr: 'UI', Value: [sopInstanceUid] }

      const out = new DicomDict(meta)
      out.dict = dict
      // Over-long values are allowed on purpose; checkEdit has already warned about them.
      return out.write({ allowInvalidVRLength: true })
    },
  }
}
