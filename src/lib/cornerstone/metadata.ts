/** Study/image metadata for the viewer, sourced from parsed DICOM header tags. */
import { getImageTags } from '@/lib/cornerstone/loadDicom'
import { SUMMARY_GROUPS, formatField } from '@/lib/dicom/summary'
import { NO_STUDY_DESCRIPTION } from '@/lib/cornerstone/studies'

export interface MetaField {
  label: string
  value: string
}

export interface MetaGroup {
  title: string
  fields: MetaField[]
}

export interface StudyHeader {
  modality: string
  description: string
  date: string
  patient: string
  rows?: number
  columns?: number
  seriesDescription: string
}

function formatDate(raw?: string): string | undefined {
  if (!raw || raw.length < 8) return raw || undefined
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
}

export function getStudyHeader(imageId: string): StudyHeader {
  const t = getImageTags(imageId)
  return {
    modality: t?.modality || '—',
    description: t?.studyDescription || NO_STUDY_DESCRIPTION,
    date: formatDate(t?.studyDate) ?? '—',
    patient: t?.patientName || 'Anonymous',
    seriesDescription: t?.seriesDescription || 'Series',
    rows: t?.rows ?? undefined,
    columns: t?.columns ?? undefined,
  }
}

/** Curated header groups for the inspector; empty fields and groups are omitted. */
export function getImageMetadata(imageId: string): MetaGroup[] {
  const summary = getImageTags(imageId)?.summary ?? {}
  return SUMMARY_GROUPS.map((group) => ({
    title: group.title,
    fields: group.fields
      .filter((f) => summary[f.keyword])
      .map((f) => ({
        label: f.label,
        value: formatField(summary[f.keyword], f.format, f.unit),
      })),
  })).filter((g) => g.fields.length > 0)
}
