import { Play, Pause, TriangleAlert } from 'lucide-react'
import { Viewport, type ViewerViewport } from '@/components/Viewport'
import type { StudyHeader } from '@/lib/cornerstone/metadata'
import { useOrientationLabels } from '@/components/viewer/useOrientationLabels'

interface ViewportStageProps {
  imageIds: string[]
  viewport: ViewerViewport | null
  /** Number of images in this series that failed to decode. */
  failedCount: number
  header: StudyHeader
  index: number
  total: number
  window: { ww: number; wl: number } | null
  playing: boolean
  onTogglePlay: () => void
  onScrub: (index: number) => void
  onViewportReady: (vp: ViewerViewport) => void
  onIndexChange: (index: number) => void
  onLoadError: (imageId: string) => void
}

function Corner({
  className,
  children,
}: {
  className: string
  children: React.ReactNode
}) {
  return (
    <div
      className={`pointer-events-none absolute font-mono text-[11px] leading-[1.6] ${className}`}
    >
      {children}
    </div>
  )
}

const MARKER = 'pointer-events-none absolute font-mono text-xs text-muted-foreground'

export function ViewportStage({
  imageIds,
  viewport,
  failedCount,
  header,
  index,
  total,
  window,
  playing,
  onTogglePlay,
  onScrub,
  onViewportReady,
  onIndexChange,
  onLoadError,
}: ViewportStageProps) {
  const labels = useOrientationLabels(viewport, imageIds[index])

  return (
    <section
      aria-label="Viewport"
      className="flex min-w-0 flex-1 flex-col"
    >
      <div className="relative min-h-[360px] flex-1 overflow-hidden bg-black">
        <Viewport
          imageIds={imageIds}
          onViewportReady={onViewportReady}
          onIndexChange={onIndexChange}
          onLoadError={onLoadError}
        />

        {/* Corner overlays */}
        <Corner className="left-3.5 top-3 text-[#d4d4d8]">
          {header.format === 'nifti' ? (
            <>
              <div>{header.description}</div>
              <div className="text-muted-foreground">NIfTI</div>
            </>
          ) : (
            <>
              <div>{header.patient.toUpperCase()}</div>
              <div className="text-muted-foreground">
                {header.modality} · {header.description}
              </div>
              <div className="text-muted-foreground">{header.date}</div>
            </>
          )}
        </Corner>

        <Corner className="right-3.5 top-3 text-right text-[#d4d4d8]">
          <div>Im {index + 1}/{total}</div>
          <div className="text-muted-foreground">{header.seriesDescription}</div>
          {header.rows && header.columns && (
            <div className="text-muted-foreground">
              {header.columns} × {header.rows}
            </div>
          )}
        </Corner>

        <Corner className="bottom-3 left-3.5 text-[#d4d4d8]">
          {window && (
            <>
              <div>
                W {window.ww}&nbsp;&nbsp;L {window.wl}
              </div>
              {/* NIfTI voxels are normalised for display, so these numbers are
                  relative contrast, not calibrated intensities (never HU). */}
              {header.format === 'nifti' && (
                <div className="text-muted-foreground">uncalibrated</div>
              )}
            </>
          )}
        </Corner>

        {/* Orientation markers, hidden when the image has no orientation */}
        {labels && (
          <>
            <span className={`${MARKER} left-1/2 top-2.5 -translate-x-1/2`}>{labels.top}</span>
            <span className={`${MARKER} bottom-2.5 left-1/2 -translate-x-1/2`}>{labels.bottom}</span>
            <span className={`${MARKER} left-3.5 top-1/2 -translate-y-1/2`}>{labels.left}</span>
            <span className={`${MARKER} right-3.5 top-1/2 -translate-y-1/2`}>{labels.right}</span>
          </>
        )}

        {failedCount > 0 && (
          <div
            role="status"
            className="absolute bottom-3 right-3.5 flex items-center gap-1.5 rounded-md border border-line-strong bg-background/90 px-2.5 py-1.5 text-xs text-foreground"
          >
            <TriangleAlert className="size-3.5 text-amber-400" />
            {failedCount === total
              ? 'This series could not be decoded.'
              : `${failedCount} of ${total} images could not be decoded.`}
          </div>
        )}
      </div>

      {/* Cine / scrub bar */}
      <div className="flex h-12 flex-none items-center gap-3 border-t border-line px-3">
        <button
          type="button"
          aria-label={playing ? 'Pause cine' : 'Play cine'}
          onClick={onTogglePlay}
          disabled={total < 2}
          className="flex size-8 items-center justify-center rounded-lg border border-line-strong bg-elevated text-foreground disabled:opacity-40"
        >
          {playing ? (
            <Pause className="size-3.5" fill="currentColor" />
          ) : (
            <Play className="size-3.5" fill="currentColor" />
          )}
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(0, total - 1)}
          value={index}
          aria-label="Slice"
          onChange={(e) => onScrub(Number(e.target.value))}
          className="flex-1 accent-primary"
          disabled={total < 2}
        />
        <span className="min-w-[72px] text-right font-mono text-xs text-[#d4d4d8]">
          {index + 1} / {total}
        </span>
      </div>
    </section>
  )
}
