import { useEffect, useRef } from 'react'
import {
  RenderingEngine,
  Enums,
  eventTarget,
  type Types,
} from '@cornerstonejs/core'
import { initCornerstone } from '@/lib/cornerstone/init'
import { ensureToolGroup, TOOL_GROUP_ID } from '@/lib/cornerstone/toolGroup'
import { ToolGroupManager } from '@cornerstonejs/tools'

const RENDERING_ENGINE_ID = 'dicom-rendering-engine'
const VIEWPORT_ID = 'dicom-stack-viewport'

interface ViewportProps {
  imageIds: string[]
  onViewportReady?: (viewport: Types.IStackViewport) => void
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

  // Set up engine + viewport once.
  useEffect(() => {
    let disposed = false
    const element = elementRef.current
    if (!element) return

    async function setup() {
      await initCornerstone()
      if (disposed || !element) return

      const engine = new RenderingEngine(RENDERING_ENGINE_ID)
      engineRef.current = engine

      engine.enableElement({
        viewportId: VIEWPORT_ID,
        type: Enums.ViewportType.STACK,
        element,
        defaultOptions: { background: [0, 0, 0] },
      })

      const toolGroup = ensureToolGroup()
      toolGroup.addViewport(VIEWPORT_ID, RENDERING_ENGINE_ID)

      const viewport = engine.getViewport(VIEWPORT_ID) as Types.IStackViewport
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
        const viewport = engine.getViewport(VIEWPORT_ID) as Types.IStackViewport | undefined
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

  // Report the current image index as the user scrolls the stack.
  useEffect(() => {
    const element = elementRef.current
    if (!element) return
    const handler = (evt: Event) => {
      const detail = (evt as CustomEvent).detail as {
        imageIdIndex?: number
        newImageIdIndex?: number
      }
      const idx = detail?.newImageIdIndex ?? detail?.imageIdIndex
      if (typeof idx === 'number') onIndexChange?.(idx)
    }
    element.addEventListener(Enums.Events.STACK_NEW_IMAGE, handler)
    return () =>
      element.removeEventListener(Enums.Events.STACK_NEW_IMAGE, handler)
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

  // Load / replace the stack whenever the imageIds change.
  useEffect(() => {
    let cancelled = false
    async function loadStack() {
      await initCornerstone()
      const engine = engineRef.current
      if (!engine || cancelled || imageIds.length === 0) return
      const viewport = engine.getViewport(VIEWPORT_ID) as Types.IStackViewport
      if (!viewport) return
      try {
        await viewport.setStack(imageIds, 0)
      } catch (err) {
        if (cancelled) return
        console.error(err)
        onLoadError?.(imageIds[0])
      }
      // A newer stack was requested while this one loaded; let that one win.
      if (cancelled) return
      viewport.render()
      onIndexChange?.(0)
    }
    void loadStack()
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

/** Imperatively move a stack viewport to a given image index. */
export function setViewportIndex(
  viewport: Types.IStackViewport | null,
  index: number,
) {
  if (!viewport) return
  try {
    viewport.setImageIdIndex(index)
  } catch {
    /* index out of range during rapid updates — ignore */
  }
}

export { VIEWPORT_ID, RENDERING_ENGINE_ID }
