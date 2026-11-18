/** Group registered DICOM images into studies → series for the browser view. */
import type { RegisteredInstance } from '@/lib/cornerstone/loadDicom'
import { sortSlices } from '@/lib/dicom/geometry'

export interface SeriesInfo {
  seriesUID: string
  seriesNumber: number | null
  description: string
  modality: string
  imageIds: string[]
  bytes: number
}

export interface StudyInfo {
  studyUID: string
  description: string
  patient: string
  date: string
  modality: string
  accession: string
  series: SeriesInfo[]
  imageCount: number
  bytes: number
}

/** Shown when a study has no Study Description of its own. */
export const NO_STUDY_DESCRIPTION = 'No study description'

function formatDate(raw?: string): string {
  if (!raw || raw.length < 8) return raw || '—'
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
}

export function groupIntoStudies(instances: RegisteredInstance[]): StudyInfo[] {
  const studies = new Map<string, StudyInfo>()
  const seriesMap = new Map<string, { info: SeriesInfo; instances: RegisteredInstance[] }>()

  instances.forEach((instance, i) => {
    const { tags } = instance
    // Fall back to per-file keys only when a UID is genuinely absent.
    const studyKey = tags.studyUID || `__study_${i}`
    const seriesKey = `${studyKey}::${tags.seriesUID || `__series_${i}`}`

    if (!studies.has(studyKey)) {
      studies.set(studyKey, {
        studyUID: studyKey,
        description: tags.studyDescription || NO_STUDY_DESCRIPTION,
        patient: tags.patientName || 'Anonymous',
        date: formatDate(tags.studyDate),
        modality: tags.modality || '—',
        accession: tags.accession || '',
        series: [],
        imageCount: 0,
        bytes: 0,
      })
    }

    if (!seriesMap.has(seriesKey)) {
      const info: SeriesInfo = {
        seriesUID: tags.seriesUID || seriesKey,
        seriesNumber: tags.seriesNumber,
        description: tags.seriesDescription || 'Series',
        modality: tags.modality || '—',
        imageIds: [],
        bytes: 0,
      }
      seriesMap.set(seriesKey, { info, instances: [] })
      studies.get(studyKey)!.series.push(info)
    }
    seriesMap.get(seriesKey)!.instances.push(instance)
  })

  for (const { info, instances: members } of seriesMap.values()) {
    const sorted = sortSlices(members, ({ tags }) => ({
      orientation: tags.imageOrientation,
      position: tags.imagePosition,
      instanceNumber: tags.instanceNumber,
    }))
    info.imageIds = sorted.flatMap((m) => m.imageIds)
    info.bytes = sorted.reduce((sum, m) => sum + m.bytes, 0)
  }

  for (const study of studies.values()) {
    study.series.sort((a, b) => (a.seriesNumber ?? 0) - (b.seriesNumber ?? 0))
    study.imageCount = study.series.reduce((n, s) => n + s.imageIds.length, 0)
    study.bytes = study.series.reduce((n, s) => n + s.bytes, 0)
  }

  return Array.from(studies.values())
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
