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
import { studyFiles } from '@/lib/cornerstone/studyFiles'
import type { StudyInfo } from '@/lib/cornerstone/studies'
import { cn } from '@/lib/utils'
import {
  DEFAULT_OPTIONS,
  mayHaveBurnedInText,
  type AnonymizeOptions,
} from '@/lib/dicom/anonymize'
import {
  downloadSink,
  isAbortError,
  pickFileSink,
  writeAnonymizedZip,
  anonymizeFiles,
} from '@/lib/exportZip'

interface AnonymizeDialogProps {
  /** The study to anonymise; the dialog is open while this is set. */
  study: StudyInfo | null
  onClose: () => void
  /** Open the anonymised copies in this session. */
  onOpenFiles: (files: File[]) => void
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

const DATE_CHOICES: { value: AnonymizeOptions['dates']; label: string; help: string }[] = [
  { value: 'remove', label: 'Remove', help: 'All dates and times are removed.' },
  {
    value: 'shift',
    label: 'Shift',
    help: 'Every date moves by the same random number of days, up to a year either way. Times, the intervals between scans and the patient’s age at each scan stay correct.',
  },
  {
    value: 'keep',
    label: 'Keep',
    help: 'Dates and times are kept as they are. Exact dates, especially the date of birth, can help identify a patient.',
  },
]

const KEEP_CHOICES: { key: 'keepAge' | 'keepSex' | 'keepSizeAndWeight'; label: string }[] = [
  { key: 'keepAge', label: 'Age' },
  { key: 'keepSex', label: 'Sex' },
  { key: 'keepSizeAndWeight', label: 'Height and weight' },
]

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`

export function AnonymizeDialog({ study: requested, onClose, onOpenFiles }: AnonymizeDialogProps) {
  // Keep showing the last study while the dialog animates closed.
  const [lastStudy, setLastStudy] = useState(requested)
  if (requested && requested !== lastStudy) setLastStudy(requested)
  const study = requested ?? lastStudy

  const [options, setOptions] = useState<AnonymizeOptions>(DEFAULT_OPTIONS)
  const [output, setOutput] = useState<'zip' | 'open'>('zip')
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const controller = useRef<AbortController | null>(null)
  const running = progress !== null

  const files = useMemo(() => (study ? studyFiles(study).map((s) => s.files) : []), [study])
  const fileCount = files.reduce((n, f) => n + f.length, 0)
  const burnedIn = useMemo(() => (study ? countBurnedInRisk(study) : 0), [study])

  // Stop a running export if the dialog goes away, e.g. when the session is cleared.
  useEffect(() => () => controller.current?.abort(), [])

  async function start() {
    if (!study) return
    const leftOut = (failed: number) =>
      failed
        ? `${plural(failed, 'file')} could not be read and ${failed === 1 ? 'was' : 'were'} left out.`
        : undefined
    let sink
    if (output === 'zip') {
      const fileName = zipName(study)
      try {
        // The save picker needs the click's user activation, so ask first.
        sink = (await pickFileSink(fileName)) ?? downloadSink(fileName)
      } catch (err) {
        if (!isAbortError(err)) toast.error('Could not open the file for saving.')
        return
      }
    }

    const abort = new AbortController()
    controller.current = abort
    setProgress({ done: 0, total: fileCount })
    const callbacks = {
      options,
      signal: abort.signal,
      onProgress: (done: number, total: number) => setProgress({ done, total }),
    }
    try {
      if (!sink) {
        const { files: copies, failed } = await anonymizeFiles(files, callbacks)
        if (failed) toast.warning(leftOut(failed))
        onClose()
        onOpenFiles(copies)
        return
      }
      const { written, failed } = await writeAnonymizedZip(files, sink, callbacks)
      toast.success(`Anonymised ${plural(written, 'file')}.`, { description: leftOut(failed) })
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
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
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
          <li>
            Other patient details, descriptions, the institution, staff names and comments are
            removed.
          </li>
          <li>
            UIDs are replaced consistently across the study, and private tags are removed.
          </li>
        </ul>

        <hr className="border-line" />

        <fieldset disabled={running} className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">Dates, including the date of birth</legend>
          <div role="radiogroup" className="inline-flex self-start rounded-lg border border-line-strong p-0.5">
            {DATE_CHOICES.map(({ value, label }) => (
              <label
                key={value}
                className={cn(
                  'cursor-pointer rounded-md px-3 py-1 text-[13px] transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                  options.dates === value
                    ? 'bg-secondary font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <input
                  type="radio"
                  name="anonymize-dates"
                  value={value}
                  checked={options.dates === value}
                  onChange={() => setOptions((o) => ({ ...o, dates: value }))}
                  className="sr-only"
                />
                {label}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {DATE_CHOICES.find((c) => c.value === options.dates)?.help}
          </p>
        </fieldset>

        <fieldset disabled={running}>
          <legend className="mb-2 text-sm font-medium">Also keep</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {KEEP_CHOICES.map(({ key, label }) => (
              <label key={key} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={options[key]}
                  onChange={(e) => setOptions((o) => ({ ...o, [key]: e.target.checked }))}
                  className="size-4 accent-primary"
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        <hr className="border-line" />

        <fieldset disabled={running} className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <legend className="sr-only">Output</legend>
          <span className="font-medium">Output</span>
          {(
            [
              ['zip', 'Save as zip'],
              ['open', 'Open in Kontrast'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="anonymize-output"
                checked={output === value}
                onChange={() => setOutput(value)}
                className="accent-primary"
              />
              {label}
            </label>
          ))}
        </fieldset>

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
          Removes identifying information from the DICOM headers, following the DICOM Basic
          Application Level Confidentiality Profile. Text or faces visible in the images are not
          removed. The result may still count as personal data under laws such as the GDPR, so
          check it before you share it.
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
            {output === 'zip' ? 'Save zip' : 'Open copy'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
