import { useCallback, useEffect, useMemo, useState } from 'react'
import { Enums, type Types } from '@cornerstonejs/core'
import { ViewerTopBar } from '@/components/viewer/ViewerTopBar'
import { SeriesRail } from '@/components/viewer/SeriesRail'
import { ViewerToolbar } from '@/components/viewer/ViewerToolbar'
import { ViewportStage } from '@/components/viewer/ViewportStage'
import { Inspector } from '@/components/viewer/Inspector'
import { useInspectorLayout } from '@/components/viewer/useInspectorLayout'
import { setViewportIndex } from '@/components/Viewport'
import { setPrimaryTool, type PrimaryTool } from '@/lib/cornerstone/toolGroup'
import {
  applyWindow,
  currentWindow,
  presetsFor,
  saveScreenshot,
  type WindowPreset,
} from '@/lib/cornerstone/windowing'
import { getStudyHeader } from '@/lib/cornerstone/metadata'
import type { StudyInfo } from '@/lib/cornerstone/studies'
import { TOOL_KEYS, isTypingTarget } from '@/lib/shortcuts'

interface ViewerProps {
  study: StudyInfo
  initialSeriesUID: string
  onBack: () => void
}

export function Viewer({ study, initialSeriesUID, onBack }: ViewerProps) {
  const [activeSeriesUID, setActiveSeriesUID] = useState(initialSeriesUID)
  const activeSeries =
    study.series.find((s) => s.seriesUID === activeSeriesUID) ?? study.series[0]
  const imageIds = activeSeries.imageIds
  const total = imageIds.length
  // NIfTI has no DICOM header to show, so the full-header view (button + H) is hidden.
  const showHeader = study.format !== 'nifti'

  const [viewport, setViewport] = useState<Types.IStackViewport | null>(null)
  const [index, setIndex] = useState(0)
  const [activeTool, setActiveTool] = useState<PrimaryTool>('WindowLevel')
  const [windowValues, setWindowValues] = useState<{ ww: number; wl: number } | null>(
    null,
  )
  const [playing, setPlaying] = useState(false)
  const [headerOpen, setHeaderOpen] = useState(false)
  const inspector = useInspectorLayout()
  const { toggleCollapsed: toggleInspector } = inspector
  const [failed, setFailed] = useState<Set<string>>(() => new Set())

  const handleLoadError = useCallback((imageId: string) => {
    setFailed((prev) => (prev.has(imageId) ? prev : new Set(prev).add(imageId)))
  }, [])
  const failedCount = imageIds.filter((id) => failed.has(id)).length

  const header = useMemo(
    () => getStudyHeader(imageIds[index] ?? imageIds[0]),
    [imageIds, index],
  )

  const handleIndexChange = useCallback(
    (i: number) => {
      setIndex(i)
      if (viewport) setWindowValues(currentWindow(viewport))
    },
    [viewport],
  )

  // Keep the W/L readout live while the window is dragged.
  useEffect(() => {
    if (!viewport) return
    const update = () => setWindowValues(currentWindow(viewport))
    update()
    viewport.element.addEventListener(Enums.Events.VOI_MODIFIED, update)
    return () => viewport.element.removeEventListener(Enums.Events.VOI_MODIFIED, update)
  }, [viewport])

  // The tool group outlives the viewer, so re-apply the selected tool to it.
  useEffect(() => {
    if (viewport) setPrimaryTool(activeTool)
  }, [viewport, activeTool])

  const handleSeriesSelect = useCallback(
    (seriesUID: string) => {
      const next = study.series.find((s) => s.seriesUID === seriesUID)
      if (!next || next === activeSeries) return
      setPlaying(false)
      setIndex(0)
      setActiveSeriesUID(seriesUID)
    },
    [study.series, activeSeries],
  )

  const handleInvert = useCallback(() => {
    if (!viewport) return
    const { invert } = viewport.getProperties()
    viewport.setProperties({ invert: !invert })
    viewport.render()
  }, [viewport])

  const handleReset = useCallback(() => {
    if (!viewport) return
    viewport.resetCamera()
    viewport.resetProperties?.()
    viewport.render()
    setWindowValues(currentWindow(viewport))
  }, [viewport])

  const presets = useMemo(() => presetsFor(header.modality), [header.modality])

  const handlePreset = useCallback(
    (preset: WindowPreset) => {
      if (viewport) applyWindow(viewport, preset)
    },
    [viewport],
  )

  const handleScrub = useCallback(
    (i: number) => {
      setViewportIndex(viewport, i)
    },
    [viewport],
  )

  const handleScreenshot = useCallback(() => {
    if (viewport) {
      saveScreenshot(viewport, `kontrast-${header.modality}-${index + 1}.png`)
    }
  }, [viewport, header.modality, index])

  // Keyboard shortcuts (see src/lib/shortcuts.ts).
  useEffect(() => {
    const toolByKey = Object.fromEntries(
      Object.entries(TOOL_KEYS).map(([tool, key]) => [key.toLowerCase(), tool]),
    ) as Record<string, PrimaryTool>

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return
      const key = e.key.toLowerCase()
      const step = (delta: number) => {
        if (!viewport || total < 1) return
        const current = viewport.getCurrentImageIdIndex()
        setViewportIndex(viewport, Math.min(total - 1, Math.max(0, current + delta)))
      }

      const preset = presets.find((p) => p.key === key)
      if (toolByKey[key]) setActiveTool(toolByKey[key])
      else if (preset) handlePreset(preset)
      else if (key === 'i') handleInvert()
      else if (key === 'r') handleReset()
      else if (key === 'c') handleScreenshot()
      else if (key === 'h' && showHeader) setHeaderOpen(true)
      else if (key === 't') toggleInspector()
      else if (key === ' ') setPlaying((p) => total > 1 && !p)
      else if (key === 'arrowup' || key === 'arrowleft') step(-1)
      else if (key === 'arrowdown' || key === 'arrowright') step(1)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [viewport, total, presets, handlePreset, handleInvert, handleReset, handleScreenshot, toggleInspector, showHeader])

  // Cine loop — advance frames while playing.
  useEffect(() => {
    if (!playing || !viewport || total < 2) return
    const id = window.setInterval(() => {
      const current = viewport.getCurrentImageIdIndex()
      setViewportIndex(viewport, (current + 1) % total)
    }, 1000 / 24)
    return () => window.clearInterval(id)
  }, [playing, viewport, total])

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      <ViewerTopBar header={header} onBack={onBack} />
      <div className="flex min-h-0 flex-1">
        <SeriesRail
          series={study.series}
          activeSeriesUID={activeSeries.seriesUID}
          onSelect={handleSeriesSelect}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <ViewerToolbar
            activeTool={activeTool}
            onToolChange={setActiveTool}
            onInvert={handleInvert}
            onReset={handleReset}
            onScreenshot={handleScreenshot}
            presets={presets}
            onPreset={handlePreset}
            inspectorCollapsed={inspector.collapsed}
            onToggleInspector={toggleInspector}
          />
          <ViewportStage
            imageIds={imageIds}
            viewport={viewport}
            failedCount={failedCount}
            header={header}
            index={index}
            total={total}
            window={windowValues}
            playing={playing}
            onTogglePlay={() => setPlaying((p) => !p)}
            onScrub={handleScrub}
            onViewportReady={setViewport}
            onIndexChange={handleIndexChange}
            onLoadError={handleLoadError}
          />
        </div>
        <Inspector
          imageId={imageIds[index] ?? imageIds[0]}
          index={index}
          total={total}
          seriesDescription={header.seriesDescription}
          headerOpen={headerOpen}
          onHeaderOpenChange={setHeaderOpen}
          showHeader={showHeader}
          width={inspector.width}
          collapsed={inspector.collapsed}
          onWidthChange={inspector.setWidth}
        />
      </div>
    </div>
  )
}
