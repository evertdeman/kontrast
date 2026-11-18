import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Copy, TriangleAlert } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { getImageTags } from '@/lib/cornerstone/loadDicom'
import { formatBytes, type StudyInfo } from '@/lib/cornerstone/studies'
import {
  formatDuration,
  formatRange,
  getStudyDetails,
  type DetailField,
} from '@/lib/dicom/studyDetails'

interface StudyDetailsDialogProps {
  /** The study to describe; the dialog is open while this is set. */
  study: StudyInfo | null
  onClose: () => void
}

async function copy(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    toast.success('Copied to the clipboard.')
  } catch {
    toast.error('Could not copy to the clipboard.')
  }
}

function Fields({ title, fields }: { title: string; fields: DetailField[] }) {
  if (fields.length === 0) return null
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border border-line-strong p-4 sm:grid-cols-4">
        {fields.map(({ label, value, copy: copyable }) => (
          <div key={label} className={copyable ? 'col-span-full min-w-0' : 'min-w-0'}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 flex items-start gap-1.5 text-sm">
              <span className={copyable ? 'break-all font-mono text-[13px]' : 'break-words'}>
                {value}
              </span>
              {copyable && (
                <button
                  type="button"
                  onClick={() => copy(value)}
                  aria-label={`Copy ${label}`}
                  className="flex-none rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  <Copy className="size-3.5" />
                </button>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

export function StudyDetailsDialog({ study: requested, onClose }: StudyDetailsDialogProps) {
  // Keep showing the last study while the dialog animates closed.
  const [lastStudy, setLastStudy] = useState(requested)
  if (requested && requested !== lastStudy) setLastStudy(requested)
  const study = requested ?? lastStudy

  const details = useMemo(() => (study ? getStudyDetails(study, getImageTags) : null), [study])
  if (!study || !details) return null

  // The description is the dialog's title; long identifiers go last, on their own row.
  const studyFields = [
    ...details.study.filter((f) => f.label !== 'Description' && !f.copy),
    ...details.study.filter((f) => f.copy),
  ]
  const summary = [
    study.date !== '—' && study.date,
    details.modalities.join(', '),
    `${study.series.length} series`,
    `${study.imageCount.toLocaleString()} images`,
    formatBytes(study.bytes),
  ].filter(Boolean)
  const hasRange = details.series.some((s) => s.rangeMm !== null)
  const hasDuration = details.series.some((s) => s.durationSeconds !== null)

  return (
    <Dialog open={requested !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-5 overflow-y-auto sm:max-w-3xl"
        // Nothing here needs typing, so don't put a focus ring on the first copy button.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{study.description}</DialogTitle>
          <DialogDescription>{summary.join(' · ')}</DialogDescription>
        </DialogHeader>

        {details.patientIds.length > 1 && (
          <div className="flex gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <TriangleAlert className="mt-0.5 size-4 flex-none text-amber-600 dark:text-amber-400" />
            <p>
              The files in this study have {details.patientIds.length} different patient IDs (
              {details.patientIds.map((id) => id || 'none').join(', ')}). They may come from
              different patients.
            </p>
          </div>
        )}

        <Fields title="Patient" fields={details.patient} />
        <Fields title="Study" fields={studyFields} />

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium text-muted-foreground">Series</h3>
          <div className="overflow-x-auto rounded-lg border border-line-strong">
            <table className="w-full text-sm">
              <thead className="bg-card text-xs text-muted-foreground">
                <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-normal">
                  <th>#</th>
                  <th>Description</th>
                  <th>Modality</th>
                  <th className="!text-right">Images</th>
                  {hasRange && <th className="!text-right">Range</th>}
                  {hasDuration && <th className="!text-right">Acquisition</th>}
                  <th className="!text-right">Size</th>
                </tr>
              </thead>
              <tbody className="font-mono text-[13px]">
                {details.series.map((s) => (
                  <tr
                    key={s.seriesUID}
                    className="border-t border-line [&>td]:px-3 [&>td]:py-2 [&>td.num]:text-right"
                  >
                    <td className="text-muted-foreground">{s.number ?? '—'}</td>
                    <td className="font-sans">{s.description}</td>
                    <td>{s.modality}</td>
                    <td className="num">{s.images.toLocaleString()}</td>
                    {hasRange && (
                      <td className="num">{s.rangeMm !== null ? formatRange(s.rangeMm) : '—'}</td>
                    )}
                    {hasDuration && (
                      <td className="num">
                        {s.durationSeconds !== null ? formatDuration(s.durationSeconds) : '—'}
                      </td>
                    )}
                    <td className="num text-muted-foreground">{formatBytes(s.bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  )
}
