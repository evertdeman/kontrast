/** The files behind a study, for exporting it. */
import { getImageFile } from '@/lib/cornerstone/loadDicom'
import type { StudyInfo } from '@/lib/cornerstone/studies'
import type { ExportSeries } from '@/lib/exportZip'

/** Each series' files in display order; multi-frame files appear once. */
export function studyFiles(study: StudyInfo): ExportSeries[] {
  return study.series.map((s) => ({
    seriesUID: s.seriesUID,
    description: s.description,
    files: [...new Set(s.imageIds.map(getImageFile).filter((f): f is File => !!f))],
  }))
}
