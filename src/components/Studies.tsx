import { useRef, useState } from 'react'
import {
  Plus,
  Trash2,
  ChevronRight,
  ArrowRight,
  Loader2,
  Layers,
  FolderOpen,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { BrandMark } from '@/components/brand/BrandMark'
import { SITE } from '@/lib/site'
import { ThemeToggle } from '@/components/ThemeToggle'
import { SiteFooter } from '@/components/SiteFooter'
import {
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
  onClearSession: () => void
}

const toFiles = (list: FileList | null): File[] => (list ? Array.from(list) : [])

const COLS =
  'grid-cols-[72px_minmax(0,2.2fr)_minmax(0,1fr)_110px_72px_84px_84px_96px]'

export function Studies({
  studies,
  indexing,
  onOpenSeries,
  onAddFiles,
  onClearSession,
}: StudiesProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
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
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center justify-between gap-3 px-6 lg:px-10">
          <div className="flex items-center gap-3">
            <button type="button" onClick={onClearSession} aria-label={`${SITE.name} home`}>
              <BrandMark />
            </button>
            <span className="text-line-strong">/</span>
            <span className="text-sm font-medium">Studies</span>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-6 px-6 py-10 lg:px-10">
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
            <Button variant="secondary" onClick={onClearSession}>
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
            <div
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-1.5 overflow-hidden rounded-full bg-line-strong"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${pct}%` }}
              />
            </div>
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
                />
              ))}
            </div>
          </div>
        ) : (
          !indexing && (
            <div className="rounded-xl border border-dashed border-line-strong px-6 py-16 text-center text-sm text-muted-foreground">
              No studies loaded. Use “Add folder” or “Add files” to open DICOM data.
            </div>
          )
        )}
      </main>

      <SiteFooter newTab />

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
}: {
  study: StudyInfo
  expanded: boolean
  onToggle: () => void
  onOpenStudy: () => void
  onOpenSeries: (seriesUID: string) => void
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
        <span className="truncate pr-3 font-medium">{study.description}</span>
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
        <button
          type="button"
          onClick={onOpenStudy}
          className="flex h-8 items-center gap-1.5 justify-self-end rounded-md border border-line-strong bg-secondary px-3 text-[13px] font-medium transition-colors hover:brightness-110"
        >
          Open
          <ArrowRight className="size-3.5" />
        </button>
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
      <div className="flex size-13 flex-none items-center justify-center rounded-md border border-line bg-gradient-to-br from-zinc-700 to-black">
        <Layers className="size-4 text-zinc-500" />
      </div>
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
