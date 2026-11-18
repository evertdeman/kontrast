import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Plus, TriangleAlert, X } from 'lucide-react'
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
import { cn } from '@/lib/utils'
import { studyFiles } from '@/lib/cornerstone/studyFiles'
import type { StudyInfo } from '@/lib/cornerstone/studies'
import { readHeaderRows, type HeaderRow } from '@/lib/dicom/header'
import {
  allKeywords,
  checkEdit,
  resolveTag,
  type Issue,
  type ResolvedTag,
  type TagEdit,
} from '@/lib/dicom/editTags'
import {
  downloadSink,
  editFiles,
  isAbortError,
  pickFileSink,
  writeEditedZip,
  type ExportSeries,
} from '@/lib/exportZip'

interface EditTagsDialogProps {
  /** The study to edit; the dialog is open while this is set. */
  study: StudyInfo | null
  onClose: () => void
  /** Open the edited copies in this session. */
  onOpenFiles: (files: File[]) => void
}

interface Rule {
  id: number
  input: string
  action: TagEdit['action']
  value: string
  seriesUID: string | null
}

const newRule = (id: number): Rule => ({ id, input: '', action: 'set', value: '', seriesUID: null })


const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`

const fieldClass =
  'h-8 rounded-md border border-line-strong bg-transparent px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'

export function EditTagsDialog({ study: requested, onClose, onOpenFiles }: EditTagsDialogProps) {
  const [rules, setRules] = useState<Rule[]>([newRule(0)])
  const [newUids, setNewUids] = useState(true)
  const [output, setOutput] = useState<'zip' | 'open'>('zip')

  // Keep showing the last study while the dialog animates closed. Reopening the same
  // study keeps its changes for another try.
  const [lastStudy, setLastStudy] = useState(requested)
  if (requested && requested !== lastStudy) {
    setLastStudy(requested)
    setRules([newRule(0)])
  }
  const study = requested ?? lastStudy
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const controller = useRef<AbortController | null>(null)
  const nextId = useRef(1)
  const keywordList = useId()
  const running = progress !== null

  const series = useMemo(() => (study ? studyFiles(study) : []), [study])
  const fileCount = series.reduce((n, s) => n + s.files.length, 0)
  const keywords = useMemo(() => allKeywords(), [])

  // The header of each series' first file, to show what a tag holds now.
  const [loaded, setLoaded] = useState<{ for: ExportSeries[]; rows: Map<string, HeaderRow[]> } | null>(null)
  const headers = loaded?.for === series ? loaded.rows : null
  useEffect(() => {
    let cancelled = false
    Promise.all(
      series.map(async (s) => [s.seriesUID, s.files[0] ? await readHeaderRows(s.files[0]) : []] as const),
    )
      .then((entries) => !cancelled && setLoaded({ for: series, rows: new Map(entries) }))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [series])

  // Stop a running export if the dialog goes away, e.g. when the session is cleared.
  useEffect(() => () => controller.current?.abort(), [])

  const checked = rules.map((rule) => {
    const tag = rule.input.trim() ? resolveTag(rule.input) : null
    const issues: Issue[] = !rule.input.trim()
      ? []
      : !tag
        ? [{ level: 'error', message: 'Unknown tag. Use a keyword such as PatientName, or a number such as (0010,0010).' }]
        : checkEdit({ tag, action: rule.action, value: rule.value, seriesUID: rule.seriesUID })
    return { rule, tag, issues }
  })
  const edits: TagEdit[] = checked
    .filter((c): c is typeof c & { tag: ResolvedTag } => !!c.tag)
    .map(({ rule, tag }) => ({ tag, action: rule.action, value: rule.value, seriesUID: rule.seriesUID }))
  const hasErrors = checked.some((c) => c.issues.some((i) => i.level === 'error'))
  const canRun = !running && edits.length > 0 && !hasErrors && fileCount > 0

  /** What a tag holds now in the series the rule covers. */
  function currentValue(tag: ResolvedTag, seriesUID: string | null): string {
    const label = `(${tag.tag.slice(0, 4)},${tag.tag.slice(4)})`
    const covered = seriesUID ? [seriesUID] : series.map((s) => s.seriesUID)
    if (!headers) return '…'
    const values = covered.map(
      (uid) => headers.get(uid)?.find((r) => r.depth === 0 && r.tag === label)?.value ?? null,
    )
    const distinct = new Set(values.map((v) => v ?? '(not present)'))
    if (distinct.size > 1) return 'differs between series'
    const [value] = distinct
    return value === '' ? '(empty)' : value
  }

  const update = (id: number, patch: Partial<Rule>) =>
    setRules((all) => all.map((r) => (r.id === id ? { ...r, ...patch } : r)))

  async function start() {
    if (!study || !canRun) return
    const abort = new AbortController()
    controller.current = abort
    const options = { newUids }
    const callbacks = {
      signal: abort.signal,
      onProgress: (done: number, total: number) => setProgress({ done, total }),
    }

    try {
      if (output === 'open') {
        setProgress({ done: 0, total: fileCount })
        const { files, failed } = await editFiles(series, edits, options, callbacks)
        if (failed) toast.warning(`${plural(failed, 'file')} could not be edited and ${failed === 1 ? 'was' : 'were'} left out.`)
        onClose()
        onOpenFiles(files)
        return
      }

      const modality = study.modality.toLowerCase().replace(/[^a-z0-9]/g, '')
      const fileName = `edited-${modality ? `${modality}-` : ''}study.zip`
      let sink
      try {
        // The save picker needs the click's user activation, so ask first.
        sink = (await pickFileSink(fileName)) ?? downloadSink(fileName)
      } catch (err) {
        if (!isAbortError(err)) toast.error('Could not open the file for saving.')
        return
      }
      setProgress({ done: 0, total: fileCount })
      const { written, failed } = await writeEditedZip(series, edits, options, sink, callbacks)
      toast.success(`Saved ${plural(written, 'edited file')}.`, {
        description: failed
          ? `${plural(failed, 'file')} could not be edited and ${failed === 1 ? 'was' : 'were'} left out.`
          : undefined,
      })
      onClose()
    } catch (err) {
      if (isAbortError(err)) return
      console.error(err)
      toast.error('Could not edit this study.', {
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
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-5 overflow-y-auto sm:max-w-4xl"
        showCloseButton={!running}
        onEscapeKeyDown={(e) => running && e.preventDefault()}
        onInteractOutside={(e) => running && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Edit tags</DialogTitle>
          <DialogDescription>
            Makes edited copies of the {plural(fileCount, 'file')} in “{study?.description}”. Your
            original files are not changed.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2.5 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 flex-none text-destructive" />
          <div className="flex flex-col gap-1">
            <p className="font-medium">For testing only</p>
            <p className="text-muted-foreground">
              Edited files can be invalid DICOM and can make software behave in unexpected ways.
              Never use them for diagnosis or send them to a clinical archive. They still contain
              patient data unless you anonymise them too.
            </p>
          </div>
        </div>

        <fieldset disabled={running} className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">Changes</legend>
          <datalist id={keywordList}>
            {keywords.map((k) => (
              <option key={k} value={k} />
            ))}
          </datalist>
          {checked.map(({ rule, tag, issues }) => (
            <div key={rule.id} className="flex flex-col gap-1.5 rounded-lg border border-line-strong p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  aria-label="Tag"
                  placeholder="Tag, e.g. PatientName or (0010,0010)"
                  list={keywordList}
                  value={rule.input}
                  onChange={(e) => update(rule.id, { input: e.target.value })}
                  className={cn(fieldClass, 'min-w-48 flex-[2]')}
                />
                <select
                  aria-label="Action"
                  value={rule.action}
                  onChange={(e) => update(rule.id, { action: e.target.value as Rule['action'] })}
                  className={fieldClass}
                >
                  <option value="set">Set to</option>
                  <option value="remove">Remove</option>
                </select>
                <input
                  aria-label="New value"
                  placeholder={rule.action === 'remove' ? '' : 'New value (empty for none)'}
                  disabled={rule.action === 'remove'}
                  value={rule.action === 'remove' ? '' : rule.value}
                  onChange={(e) => update(rule.id, { value: e.target.value })}
                  className={cn(fieldClass, 'min-w-40 flex-[2] font-mono')}
                />
                <select
                  aria-label="Series"
                  value={rule.seriesUID ?? ''}
                  onChange={(e) => update(rule.id, { seriesUID: e.target.value || null })}
                  className={cn(fieldClass, 'max-w-48')}
                >
                  <option value="">All series</option>
                  {study?.series.map((s) => (
                    <option key={s.seriesUID} value={s.seriesUID}>
                      {s.seriesNumber != null ? `#${s.seriesNumber} ` : ''}
                      {s.description}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  aria-label="Remove change"
                  onClick={() =>
                    setRules((all) => (all.length > 1 ? all.filter((r) => r.id !== rule.id) : [newRule(nextId.current++)]))
                  }
                  className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>
              {tag && (
                <p className="font-mono text-xs text-muted-foreground">
                  ({tag.tag.slice(0, 4)},{tag.tag.slice(4)}) {tag.keyword} · {tag.vr} · now:{' '}
                  <span className="text-foreground">{currentValue(tag, rule.seriesUID)}</span>
                </p>
              )}
              {issues.map((issue) => (
                <p
                  key={issue.message}
                  className={cn(
                    'text-xs',
                    issue.level === 'error' ? 'text-destructive' : 'text-amber-600 dark:text-amber-400',
                  )}
                >
                  {issue.message}
                </p>
              ))}
            </div>
          ))}
          <Button
            variant="secondary"
            size="sm"
            className="self-start"
            onClick={() => setRules((all) => [...all, newRule(nextId.current++)])}
          >
            <Plus className="size-4" />
            Add change
          </Button>
        </fieldset>

        <fieldset disabled={running} className="flex flex-col gap-3">
          <label className="flex cursor-pointer items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={newUids}
              onChange={(e) => {
                setNewUids(e.target.checked)
                if (!e.target.checked) setOutput('zip')
              }}
              className="mt-0.5 size-4 accent-primary"
            />
            <span>
              Give the copies new UIDs (recommended)
              <span className="block text-xs text-muted-foreground">
                So they can’t overwrite or be confused with the originals in an archive or product.
                Turn this off only to test how software handles existing UIDs.
              </span>
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-3 text-sm">
            <span className="font-medium">Output</span>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="edit-output"
                checked={output === 'zip'}
                onChange={() => setOutput('zip')}
                className="accent-primary"
              />
              Save as zip
            </label>
            <label className={cn('flex items-center gap-2', newUids ? 'cursor-pointer' : 'opacity-50')}>
              <input
                type="radio"
                name="edit-output"
                checked={output === 'open'}
                disabled={!newUids}
                onChange={() => setOutput('open')}
                className="accent-primary"
              />
              Open in Kontrast
            </label>
            {!newUids && (
              <span className="text-xs text-muted-foreground">
                Opening needs new UIDs; with the same UIDs the copies count as already open.
              </span>
            )}
          </div>
        </fieldset>

        {progress && (
          <div className="flex flex-col gap-2">
            <div className="flex justify-between text-[13px]">
              <span className="flex items-center gap-2">
                <Loader2 className="size-3.5 animate-spin" />
                Editing
              </span>
              <span className="font-mono text-muted-foreground">
                {progress.done} / {progress.total} files · {pct}%
              </span>
            </div>
            <ProgressBar value={pct} label="Editing" />
          </div>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={cancel}>
            Cancel
          </Button>
          <Button onClick={start} disabled={!canRun}>
            {output === 'zip' ? 'Save zip' : 'Open copy'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
