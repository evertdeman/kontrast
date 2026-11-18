import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ProgressBar } from '@/components/ProgressBar'
import { getImageFile, getImageTags } from '@/lib/cornerstone/loadDicom'
import type { StudyInfo } from '@/lib/cornerstone/studies'
import { mayHaveBurnedInText } from '@/lib/dicom/anonymize'
import {
  downloadSink,
  isAbortError,
  pickFileSink,
  writeAnonymizedZip,
} from '@/lib/anonymizedZip'

interface AnonymizeDialogProps {
  /** The study to anonymise; the dialog is open while this is set. */
  study: StudyInfo | null
  onClose: () => void
}

/** Each series' files in display order; multi-frame files appear once. */
function seriesFiles(study: StudyInfo): File[][] {
  return study.series.map((series) => [
    ...new Set(series.imageIds.map(getImageFile).filter((f): f is File => !!f)),
  ])
}

function countBurnedInRisk(study: StudyInfo): number {
  const files = new Map<File, boolean>()
  for (const imageId of study.series.flatMap((s) => s.imageIds)) {
    const file = getImageFile(imageId)
    const tags = getImageTags(imageId)
    if (file && tags && !files.has(file)) files.set(file, mayHaveBurnedInText(tags))
  }
  return [...files.values()].filter(Boolean).length
}

function zipName(study: StudyInfo): string {
  const modality = study.modality.toLowerCase().replace(/[^a-z0-9]/g, '')
  return `anonymised-${modality ? `${modality}-` : ''}study.zip`
}

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`

export function AnonymizeDialog({ study: requested, onClose }: AnonymizeDialogProps) {
  // Keep showing the last study while the dialog animates closed.
  const [lastStudy, setLastStudy] = useState(requested)
  if (requested && requested !== lastStudy) setLastStudy(requested)
  const study = requested ?? lastStudy

  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const controller = useRef<AbortController | null>(null)
  const running = progress !== null

  const files = useMemo(() => (study ? seriesFiles(study) : []), [study])
  const fileCount = files.reduce((n, f) => n + f.length, 0)
  const burnedIn = useMemo(() => (study ? countBurnedInRisk(study) : 0), [study])

  // Stop a running export if the dialog goes away, e.g. when the session is cleared.
  useEffect(() => () => controller.current?.abort(), [])

  async function start() {
    if (!study) return
    const fileName = zipName(study)
    let sink
    try {
      // The save picker needs the click's user activation, so ask first.
      sink = (await pickFileSink(fileName)) ?? downloadSink(fileName)
    } catch (err) {
      if (!isAbortError(err)) toast.error('Could not open the file for saving.')
      return
    }

    const abort = new AbortController()
    controller.current = abort
    setProgress({ done: 0, total: fileCount })
    try {
      const { written, failed } = await writeAnonymizedZip(files, sink, {
        signal: abort.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      })
      toast.success(`Anonymised ${plural(written, 'file')}.`, {
        description: failed
          ? `${plural(failed, 'file')} could not be read and ${failed === 1 ? 'was' : 'were'} left out.`
          : undefined,
      })
      onClose()
    } catch (err) {
      if (isAbortError(err)) return
      console.error(err)
      toast.error('Could not anonymise this study.', {
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      controller.current = null
      setProgress(null)
    }
  }

  function cancel() {
    if (controller.current) controller.current.abort()
    else onClose()
  }

  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <Dialog open={requested !== null} onOpenChange={(open) => !open && !running && onClose()}>
      <DialogContent
        showCloseButton={!running}
        onEscapeKeyDown={(e) => running && e.preventDefault()}
        onInteractOutside={(e) => running && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Anonymise study</DialogTitle>
          <DialogDescription>
            Saves anonymised copies of the {plural(fileCount, 'file')} in this study as a zip.
            Your original files are not changed, and nothing leaves this device.
          </DialogDescription>
        </DialogHeader>

        <ul className="list-disc space-y-1.5 pl-5 text-sm">
          <li>The patient’s name and ID are replaced with a random code, such as ANON-1A2B3C4D.</li>
          <li>The birth date, sex, age and other patient details are removed.</li>
          <li>All dates and times are removed.</li>
          <li>
            Study and series descriptions, the institution, staff names and comments are removed.
          </li>
          <li>
            UIDs are replaced consistently across the study, and private tags are removed.
          </li>
        </ul>

        {burnedIn > 0 && (
          <div className="flex gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <TriangleAlert className="mt-0.5 size-4 flex-none text-amber-600 dark:text-amber-400" />
            <p>
              {burnedIn === fileCount ? 'These images' : `${plural(burnedIn, 'image')} in this study`}{' '}
              may have text burned into the pixels, as is common for ultrasound and screenshots.
              Only the header is anonymised, so check {burnedIn === 1 ? 'it' : 'them'} before
              sharing.
            </p>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Based on the DICOM Basic Application Level Confidentiality Profile. Check the result
          before you share it.
        </p>

        {progress && (
          <div className="flex flex-col gap-2">
            <div className="flex justify-between text-[13px]">
              <span className="flex items-center gap-2">
                <Loader2 className="size-3.5 animate-spin" />
                Anonymising
              </span>
              <span className="font-mono text-muted-foreground">
                {progress.done} / {progress.total} files · {pct}%
              </span>
            </div>
            <ProgressBar value={pct} label="Anonymising" />
          </div>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={cancel}>
            Cancel
          </Button>
          <Button onClick={start} disabled={running || fileCount === 0}>
            Save zip
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
