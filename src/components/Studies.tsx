import { useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Plus,
  Trash2,
  ChevronRight,
  ArrowRight,
  Loader2,
  FolderOpen,
  VenetianMask,
  ListX,
  Ellipsis,
  Info,
  FilePen,
  Download,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ConfirmDialog, type Confirmation } from '@/components/ConfirmDialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { AnonymizeDialog } from '@/components/AnonymizeDialog'
import { ProgressBar } from '@/components/ProgressBar'
import { SeriesThumbnail } from '@/components/SeriesThumbnail'
import { StudyDetailsDialog } from '@/components/StudyDetailsDialog'
import { EditTagsDialog } from '@/components/EditTagsDialog'
import { getImageFile } from '@/lib/cornerstone/loadDicom'
import { studyFiles } from '@/lib/cornerstone/studyFiles'
import {
  copyKindOf,
  type CopyKind,
  downloadSink,
  isAbortError,
  pickFileSink,
  writeFilesZip,
} from '@/lib/exportZip'
import { SiteFooter } from '@/components/SiteFooter'
import { SiteHeader } from '@/components/SiteHeader'
import {
  NO_STUDY_DESCRIPTION,
  formatBytes,
  type StudyInfo,
  type SeriesInfo,
} from '@/lib/cornerstone/studies'
import type { IndexingProgress } from '@/lib/cornerstone/loadDicom'

interface StudiesProps {
  studies: StudyInfo[]
  indexing: IndexingProgress | null
  onOpenSeries: (studyUID: string, seriesUID: string) => void
  onAddFiles: (files: File[]) => void
  onRemoveStudy: (study: StudyInfo) => void
  onClearSession: () => void
}

const toFiles = (list: FileList | null): File[] => (list ? Array.from(list) : [])

/** How Kontrast made a study, if it is a copy (anonymised or edited) rather than the user's own files. */
const copyKindOfStudy = (study: StudyInfo) => copyKindOf(getImageFile(study.series[0]?.imageIds[0] ?? ''))
const isCopy = (study: StudyInfo) => !!copyKindOfStudy(study)

const COPY_LABELS: Record<CopyKind, string> = { anonymised: 'Anonymised copy', edited: 'Edited copy' }

const COLS =
  'grid-cols-[72px_minmax(0,2.2fr)_minmax(0,1fr)_110px_72px_84px_84px_128px]'

export function Studies({
  studies,
  indexing,
  onOpenSeries,
  onAddFiles,
  onRemoveStudy,
  onClearSession,
}: StudiesProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [anonymizing, setAnonymizing] = useState<StudyInfo | null>(null)
  const [describing, setDescribing] = useState<StudyInfo | null>(null)
  const [editing, setEditing] = useState<StudyInfo | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)

  // Clearing throws away everything indexed so far, so ask first when there is something to lose.
  const requestClear = () => {
    if (studies.length === 0 && !indexing) return onClearSession()
    setConfirmation({
      title: 'Clear all studies?',
      description: `${
        studies.length === 0
          ? 'Indexing stops and nothing is kept.'
          : `${studies.length === 1 ? 'The study' : `All ${studies.length} studies`} will be removed from Kontrast.`
      } Your files are not changed, and you can open them again.${
        studies.some(isCopy)
          ? ' Copies made in Kontrast exist only here, so download any you want to keep first.'
          : ''
      }`,
      confirmLabel: 'Clear all',
      onConfirm: onClearSession,
    })
  }

  /** Save a copy Kontrast made (anonymised or edited) as a zip again. */
  async function downloadStudy(study: StudyInfo) {
    const series = studyFiles(study)
    const kind = copyKindOf(series[0]?.files[0]) ?? 'kontrast'
    const modality = study.modality.toLowerCase().replace(/[^a-z0-9]/g, '')
    const fileName = `${kind}-${modality ? `${modality}-` : ''}study.zip`
    let sink
    try {
      // The save picker needs the click's user activation, so ask first.
      sink = (await pickFileSink(fileName)) ?? downloadSink(fileName)
    } catch (err) {
      if (!isAbortError(err)) toast.error('Could not open the file for saving.')
      return
    }
    const id = toast.loading('Saving the zip…')
    try {
      const { written } = await writeFilesZip(series, sink)
      toast.success(`Saved ${written.toLocaleString()} file${written === 1 ? '' : 's'}.`, { id })
    } catch (err) {
      console.error(err)
      toast.error('Could not save the zip.', {
        id,
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }

  const requestRemove = (study: StudyInfo) =>
    setConfirmation({
      title: 'Remove this study?',
      description: isCopy(study)
        ? `“${study.description}” is a copy made in Kontrast and exists only here. Download it first if you want to keep it.`
        : `“${study.description}” will be removed from Kontrast. Your files are not changed, and you can open them again.`,
      confirmLabel: 'Remove',
      onConfirm: () => onRemoveStudy(study),
    })
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)

  const toggle = (uid: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })

  const pct =
    indexing && indexing.total > 0
      ? Math.round((indexing.done / indexing.total) * 100)
      : 0

  return (
    <div className="flex min-h-full flex-col bg-background text-foreground">
      {/* Header */}
      <SiteHeader section="Studies" home={{ onClick: requestClear }} />

      {/* Main */}
      <main className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-6 px-4 py-10 sm:px-6 lg:px-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[28px] font-semibold tracking-tight">Studies</h1>
            <p className="text-sm text-muted-foreground">
              Grouped by StudyInstanceUID. Held in memory until you close this tab.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => folderInput.current?.click()} disabled={!!indexing}>
              <FolderOpen className="size-4" />
              Add folder
            </Button>
            <Button
              variant="secondary"
              onClick={() => fileInput.current?.click()}
              disabled={!!indexing}
            >
              <Plus className="size-4" />
              Add files
            </Button>
            <Button variant="secondary" onClick={requestClear}>
              <Trash2 className="size-4" />
              Clear all
            </Button>
          </div>
        </div>

        {/* Indexing progress */}
        {indexing && (
          <div className="flex flex-col gap-3 rounded-xl border border-line-strong bg-card p-4">
            <div className="flex flex-wrap justify-between gap-3 text-[13px]">
              <span className="flex items-center gap-2">
                <Loader2 className="size-3.5 animate-spin" />
                {indexing.unpacking ? 'Unpacking zip archives' : 'Indexing DICOM headers'}
              </span>
              {indexing.total > 0 && (
                <span className="font-mono text-muted-foreground">
                  {indexing.done} / {indexing.total} files · {pct}%
                </span>
              )}
            </div>
            <ProgressBar value={pct} />
          </div>
        )}

        {/* Studies table */}
        {studies.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-line-strong">
            <div className="min-w-[860px]">
              <div
                className={cn(
                  'grid items-center gap-3 border-b border-line-strong bg-card px-3 py-2.5 text-xs text-muted-foreground',
                  COLS,
                )}
              >
                <span>Modality</span>
                <span>Description</span>
                <span>Patient</span>
                <span>Date</span>
                <span>Series</span>
                <span>Images</span>
                <span>Size</span>
                <span />
              </div>

              {studies.map((study) => (
                <StudyRow
                  key={study.studyUID}
                  study={study}
                  expanded={expanded.has(study.studyUID)}
                  onToggle={() => toggle(study.studyUID)}
                  onOpenStudy={() =>
                    study.series[0] &&
                    onOpenSeries(study.studyUID, study.series[0].seriesUID)
                  }
                  onOpenSeries={(seriesUID) => onOpenSeries(study.studyUID, seriesUID)}
                  onAnonymize={() => setAnonymizing(study)}
                  onShowDetails={() => setDescribing(study)}
                  onEditTags={() => setEditing(study)}
                  copyKind={copyKindOfStudy(study)}
                  onDownload={isCopy(study) ? () => downloadStudy(study) : undefined}
                  onRemove={() => requestRemove(study)}
                />
              ))}
            </div>
          </div>
        ) : (
          !indexing && (
            <div className="rounded-xl border border-dashed border-line-strong px-6 py-16 text-center text-sm text-muted-foreground">
              No studies loaded. Use “Add folder” or “Add files” to open DICOM or NIfTI data.
            </div>
          )
        )}
      </main>

      <SiteFooter newTab />

      <AnonymizeDialog
        study={anonymizing}
        onClose={() => setAnonymizing(null)}
        onOpenFiles={onAddFiles}
      />
      <StudyDetailsDialog study={describing} onClose={() => setDescribing(null)} />
      <EditTagsDialog
        study={editing}
        onClose={() => setEditing(null)}
        onOpenFiles={onAddFiles}
      />

      <ConfirmDialog confirmation={confirmation} onClose={() => setConfirmation(null)} />

      {/* Hidden inputs — fully local, no upload */}
      <input
        ref={fileInput}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          onAddFiles(toFiles(e.target.files))
          e.target.value = ''
        }}
      />
      <input
        ref={folderInput}
        type="file"
        multiple
        className="hidden"
        // @ts-expect-error non-standard but widely supported folder picker
        webkitdirectory=""
        directory=""
        onChange={(e) => {
          onAddFiles(toFiles(e.target.files))
          e.target.value = ''
        }}
      />
    </div>
  )
}

function StudyRow({
  study,
  expanded,
  onToggle,
  onOpenStudy,
  onOpenSeries,
  onAnonymize,
  onShowDetails,
  onEditTags,
  copyKind,
  onDownload,
  onRemove,
}: {
  study: StudyInfo
  copyKind: CopyKind | undefined
  expanded: boolean
  onToggle: () => void
  onOpenStudy: () => void
  onOpenSeries: (seriesUID: string) => void
  onAnonymize: () => void
  onShowDetails: () => void
  onEditTags: () => void
  /** Only for copies Kontrast made, which exist nowhere else. */
  onDownload?: () => void
  onRemove: () => void
}) {
  return (
    <div className="border-b border-line last:border-b-0">
      <div className={cn('grid items-center gap-3 px-3 py-3 text-sm', COLS)}>
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-1.5 justify-self-start rounded-md border border-line-strong px-2 py-0.5 font-mono text-xs font-medium"
        >
          <ChevronRight
            className={cn('size-3 transition-transform', expanded && 'rotate-90')}
          />
          {study.modality}
        </button>
        <div className="flex min-w-0 items-center gap-2 pr-3">
          <button
            type="button"
            onClick={onShowDetails}
            title="Show study details"
            className={cn(
              'truncate text-left underline-offset-4 hover:underline',
              study.description === NO_STUDY_DESCRIPTION ? 'text-muted-foreground' : 'font-medium',
            )}
          >
            {study.description}
          </button>
          {copyKind && (
            <span className="flex-none rounded-md border border-line-strong px-1.5 py-px text-[11px] text-muted-foreground">
              {COPY_LABELS[copyKind]}
            </span>
          )}
        </div>
        <span className="truncate text-muted-foreground">{study.patient}</span>
        <span className="font-mono text-[13px] text-muted-foreground">
          {study.date}
        </span>
        <span className="font-mono text-[13px]">{study.series.length}</span>
        <span className="font-mono text-[13px]">
          {study.imageCount.toLocaleString()}
        </span>
        <span className="font-mono text-[13px] text-muted-foreground">
          {formatBytes(study.bytes)}
        </span>
        <div className="flex items-center gap-2 justify-self-end">
          {/* Not modal, so the dialogs these items open get focus cleanly. */}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Study actions"
                className="flex size-8 items-center justify-center rounded-md border border-line-strong text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground data-[state=open]:bg-secondary data-[state=open]:text-foreground"
              >
                <Ellipsis className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              <DropdownMenuItem onSelect={onShowDetails}>
                <Info />
                Details
              </DropdownMenuItem>
              {/* Anonymise and edit rewrite DICOM headers; NIfTI is view-only. */}
              {study.format !== 'nifti' && (
                <>
                  <DropdownMenuItem onSelect={onAnonymize}>
                    <VenetianMask />
                    Anonymise…
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={onEditTags}>
                    <FilePen />
                    Edit tags…
                  </DropdownMenuItem>
                </>
              )}
              {onDownload && (
                <DropdownMenuItem onSelect={onDownload}>
                  <Download />
                  Download zip
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onRemove}>
                <ListX />
                Remove from session
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            onClick={onOpenStudy}
            className="flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-secondary px-3 text-[13px] font-medium transition-colors hover:brightness-110"
          >
            Open
            <ArrowRight className="size-3.5" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="grid gap-2.5 bg-card px-3 pb-4 pl-[84px] pt-1 sm:grid-cols-2 lg:grid-cols-4">
          {study.series.map((series) => (
            <SeriesCard
              key={series.seriesUID}
              series={series}
              onOpen={() => onOpenSeries(series.seriesUID)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SeriesCard({
  series,
  onOpen,
}: {
  series: SeriesInfo
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex items-center gap-2.5 rounded-[10px] border border-line-strong bg-background p-2 text-left transition-colors hover:border-ring"
    >
      <SeriesThumbnail imageIds={series.imageIds} className="size-13" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-[13px] font-medium">
          {series.description}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {series.modality} · {series.imageIds.length} img
        </span>
      </div>
    </button>
  )
}
