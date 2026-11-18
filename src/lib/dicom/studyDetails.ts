/**
 * Everything the study details dialog shows, worked out from the tags
 * captured at registration. Pure, so it can be unit-tested without Cornerstone.
 */
import type { DicomTags } from '@/lib/dicom/parse'
import type { StudyInfo } from '@/lib/cornerstone/studies'
import { cross, dot, type Vec3 } from '@/lib/dicom/geometry'
import { SUMMARY_GROUPS, formatField } from '@/lib/dicom/summary'

export interface DetailField {
  label: string
  value: string
  /** Show a copy button, for long identifiers. */
  copy?: boolean
}

export interface SeriesDetails {
  seriesUID: string
  number: number | null
  description: string
  modality: string
  images: number
  bytes: number
  /** Distance between the first and last slice along the slice normal, in mm. */
  rangeMm: number | null
  /** Time between the first and last acquisition, in seconds. */
  durationSeconds: number | null
}

export interface StudyDetails {
  patient: DetailField[]
  study: DetailField[]
  modalities: string[]
  /** More than one means files from different patients share this study UID. */
  patientIds: string[]
  series: SeriesDetails[]
}

type TagsOf = (imageId: string) => DicomTags | undefined

/** The distinct instances (files) behind a list of imageIds; frames share tags. */
function instances(imageIds: string[], tagsOf: TagsOf): DicomTags[] {
  return [...new Set(imageIds.map(tagsOf).filter((t): t is DicomTags => !!t))]
}

/** Seconds since midnight for a DICOM TM value, or null. */
export function parseTime(raw: string | undefined): number | null {
  const m = /^(\d{2})(\d{2})?(\d{2})?(\.\d+)?/.exec(raw?.trim() ?? '')
  if (!m) return null
  return Number(m[1]) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) + Number(m[4] ?? 0)
}

function rangeMm(tags: DicomTags[]): number | null {
  const orientation = tags.find((t) => t.imageOrientation)?.imageOrientation
  if (!orientation) return null
  const normal = cross(orientation.slice(0, 3) as Vec3, orientation.slice(3, 6) as Vec3)
  const offsets = tags
    .map((t) => t.imagePosition)
    .filter((p): p is number[] => !!p)
    .map((p) => dot(p as Vec3, normal))
  if (offsets.length < 2) return null
  const range = Math.max(...offsets) - Math.min(...offsets)
  return range > 0 ? range : null
}

function durationSeconds(tags: DicomTags[]): number | null {
  const times = tags
    .map((t) => parseTime(t.summary.AcquisitionTime))
    .filter((t): t is number => t !== null)
  if (times.length < 2) return null
  const duration = Math.max(...times) - Math.min(...times)
  return duration > 0 ? duration : null
}

/** Whole years between two YYYYMMDD dates, or null. */
export function ageInYears(birthDate: string | undefined, onDate: string | undefined): number | null {
  const parse = (d?: string) => (d && /^\d{8}$/.test(d) ? [+d.slice(0, 4), +d.slice(4, 6), +d.slice(6, 8)] : null)
  const birth = parse(birthDate)
  const on = parse(onDate)
  if (!birth || !on) return null
  const age = on[0] - birth[0] - (on[1] < birth[1] || (on[1] === birth[1] && on[2] < birth[2]) ? 1 : 0)
  return age >= 0 ? age : null
}

/** Fields of one summary group, formatted, skipping empty ones. */
function groupFields(title: string, summary: Record<string, string>, copy: string[] = []): DetailField[] {
  const group = SUMMARY_GROUPS.find((g) => g.title === title)
  return (group?.fields ?? [])
    .filter((f) => summary[f.keyword])
    .map((f) => ({
      label: f.label,
      value: formatField(summary[f.keyword], f.format, f.unit),
      ...(copy.includes(f.keyword) && { copy: true }),
    }))
}

export function getStudyDetails(study: StudyInfo, tagsOf: TagsOf): StudyDetails {
  const all = instances(
    study.series.flatMap((s) => s.imageIds),
    tagsOf,
  )
  const summary = all[0]?.summary ?? {}

  const patient = groupFields('Patient', summary)
  // Always show an age: as stated, else from the birth and study dates.
  if (!summary.PatientAge) {
    const age = ageInYears(summary.PatientBirthDate, summary.StudyDate)
    const at = patient.findIndex((f) => f.label === 'Sex')
    patient.splice(at < 0 ? patient.length : at + 1, 0, {
      label: 'Age',
      value: age === null ? 'Unknown' : `${age} year${age === 1 ? '' : 's'}`,
    })
  }

  return {
    patient,
    study: groupFields('Study', summary, ['StudyInstanceUID']),
    modalities: [...new Set(study.series.map((s) => s.modality).filter((m) => m && m !== '—'))],
    patientIds: [...new Set(all.map((t) => t.patientId))],
    series: study.series.map((s) => {
      const tags = instances(s.imageIds, tagsOf)
      return {
        seriesUID: s.seriesUID,
        number: s.seriesNumber,
        description: s.description,
        modality: s.modality,
        images: s.imageIds.length,
        bytes: s.bytes,
        rangeMm: rangeMm(tags),
        durationSeconds: durationSeconds(tags),
      }
    }),
  }
}

export function formatDuration(seconds: number): string {
  const total = Math.round(seconds)
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  if (minutes === 0) return `${rest} s`
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`
}

export function formatRange(mm: number): string {
  return mm < 10 ? `${mm.toFixed(1)} mm` : `${Math.round(mm)} mm`
}
