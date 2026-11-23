import { useEffect, useRef } from 'react'
import {
  RenderingEngine,
  Enums,
  eventTarget,
  type Types,
} from '@cornerstonejs/core'
import { initCornerstone } from '@/lib/cornerstone/init'
import { ensureNiftiVolume } from '@/lib/cornerstone/loadNifti'
import { currentSlice, gotoSlice, type AnyViewport } from '@/lib/cornerstone/viewportNav'
import { ensureToolGroup, TOOL_GROUP_ID } from '@/lib/cornerstone/toolGroup'
import { ToolGroupManager } from '@cornerstonejs/tools'

const RENDERING_ENGINE_ID = 'kontrast-rendering-engine'
const VIEWPORT_ID = 'kontrast-viewport'

/** NIfTI slice ids render as a Volume viewport; DICOM ids as a Stack viewport. */
const isNiftiStack = (imageIds: string[]) => imageIds[0]?.startsWith('nifti:') ?? false

interface ViewportProps {
  imageIds: string[]
  onViewportReady?: (viewport: AnyViewport) => void
  onIndexChange?: (index: number) => void
  onLoadError?: (imageId: string) => void
}

export function Viewport({
  imageIds,
  onViewportReady,
  onIndexChange,
  onLoadError,
}: ViewportProps) {
  const elementRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<RenderingEngine | null>(null)
  // Fixed for this component's life; the viewer remounts Viewport per study.
  const volumeRef = useRef(isNiftiStack(imageIds))

  // Set up engine + viewport once.
  useEffect(() => {
    let disposed = false
    const element = elementRef.current
    if (!element) return
    const isVolume = volumeRef.current

    async function setup() {
      await initCornerstone()
      if (disposed || !element) return

      const engine = new RenderingEngine(RENDERING_ENGINE_ID)
      engineRef.current = engine

      engine.enableElement({
        viewportId: VIEWPORT_ID,
        type: isVolume ? Enums.ViewportType.ORTHOGRAPHIC : Enums.ViewportType.STACK,
        element,
        defaultOptions: {
          background: [0, 0, 0],
          // Show the volume's native slices, matching how a stack would.
          ...(isVolume && { orientation: Enums.OrientationAxis.ACQUISITION }),
        },
      })

      const toolGroup = ensureToolGroup()
      toolGroup.addViewport(VIEWPORT_ID, RENDERING_ENGINE_ID)

      const viewport = engine.getViewport(VIEWPORT_ID) as AnyViewport
      onViewportReady?.(viewport)
    }

    void setup()

    return () => {
      disposed = true
      ToolGroupManager.getToolGroup(TOOL_GROUP_ID)?.removeViewports(
        RENDERING_ENGINE_ID,
        VIEWPORT_ID,
      )
      engineRef.current?.destroy()
      engineRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep the canvas in step with its container (window resize, panel drag).
  useEffect(() => {
    const element = elementRef.current
    if (!element) return
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const engine = engineRef.current
        if (!engine) return
        // Refit to the new size, then restore zoom/pan/rotation/flips, which
        // are relative to the fitted view, so an unzoomed image stays fitted.
        const viewport = engine.getViewport(VIEWPORT_ID) as AnyViewport | undefined
        let presentation: Types.ViewPresentation | undefined
        try {
          presentation = viewport?.getViewPresentation()
        } catch {
          presentation = undefined
        }
        engine.resize(true, false)
        if (viewport && presentation && Number.isFinite(presentation.zoom)) {
          viewport.setViewPresentation(presentation)
          viewport.render()
        }
      })
    })
    observer.observe(element)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  // Report the current slice index as the user scrolls.
  useEffect(() => {
    const element = elementRef.current
    if (!element) return
    const event = volumeRef.current
      ? Enums.Events.VOLUME_NEW_IMAGE
      : Enums.Events.STACK_NEW_IMAGE
    const handler = () => {
      const viewport = engineRef.current?.getViewport(VIEWPORT_ID) as AnyViewport | undefined
      if (viewport) onIndexChange?.(currentSlice(viewport))
    }
    element.addEventListener(event, handler)
    return () => element.removeEventListener(event, handler)
  }, [onIndexChange])

  // Report images that fail to load or decode.
  useEffect(() => {
    const handler = (evt: Event) => {
      const imageId = (evt as CustomEvent<{ imageId?: string }>).detail?.imageId
      if (imageId && imageIds.includes(imageId)) onLoadError?.(imageId)
    }
    eventTarget.addEventListener(Enums.Events.IMAGE_LOAD_ERROR, handler)
    return () => eventTarget.removeEventListener(Enums.Events.IMAGE_LOAD_ERROR, handler)
  }, [imageIds, onLoadError])

  // Load / replace the image data whenever the imageIds change.
  useEffect(() => {
    let cancelled = false
    async function load() {
      await initCornerstone()
      const engine = engineRef.current
      if (!engine || cancelled || imageIds.length === 0) return
      const viewport = engine.getViewport(VIEWPORT_ID) as AnyViewport
      if (!viewport) return
      try {
        if (volumeRef.current) {
          const volumeId = await ensureNiftiVolume(imageIds)
          if (cancelled) return
          await (viewport as Types.IVolumeViewport).setVolumes([{ volumeId }])
        } else {
          await (viewport as Types.IStackViewport).setStack(imageIds, 0)
        }
      } catch (err) {
        if (cancelled) return
        console.error(err)
        onLoadError?.(imageIds[0])
        return
      }
      // A newer request arrived while this one loaded; let that one win.
      if (cancelled) return
      viewport.render()
      // Volume viewports open on their middle slice, not 0; report the real one.
      onIndexChange?.(currentSlice(viewport))
    }
    void load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageIds])

  return (
    <div
      ref={elementRef}
      className="size-full bg-black"
      // Cornerstone draws onto a canvas it manages inside this element.
      onContextMenu={(e) => e.preventDefault()}
    />
  )
}

/** Imperatively move a viewport to a given slice index. */
export function setViewportIndex(viewport: AnyViewport | null, index: number) {
  if (!viewport) return
  gotoSlice(viewport, index)
}
