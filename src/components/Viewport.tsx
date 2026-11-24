import { useEffect, useRef } from 'react'
import {
  RenderingEngine,
  Enums,
  cache,
  eventTarget,
  volumeLoader,
  utilities as csUtils,
  type Types,
} from '@cornerstonejs/core'
import { initCornerstone } from '@/lib/cornerstone/init'
import { ensureToolGroup, TOOL_GROUP_ID } from '@/lib/cornerstone/toolGroup'
import { isNiftiImageId, niftiVolumeId, niftiVoiRange } from '@/lib/cornerstone/loadNifti'
import { ToolGroupManager } from '@cornerstonejs/tools'

const RENDERING_ENGINE_ID = 'dicom-rendering-engine'
const VIEWPORT_ID = 'dicom-stack-viewport'

/** DICOM renders as a stack of 2D images; NIfTI as a 3D volume. */
export type ViewerViewport = Types.IStackViewport | Types.IVolumeViewport

const isVolumeViewport = (vp: ViewerViewport): vp is Types.IVolumeViewport =>
  vp.type === Enums.ViewportType.ORTHOGRAPHIC

interface ViewportProps {
  imageIds: string[]
  onViewportReady?: (viewport: ViewerViewport) => void
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

  // NIfTI is shown in a volume viewport; DICOM in a stack. A viewer only ever
  // holds one format, so this is stable for a given mount.
  const volume = isNiftiImageId(imageIds[0] ?? '')

  // Set up engine + viewport once per viewport type.
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
        type: volume ? Enums.ViewportType.ORTHOGRAPHIC : Enums.ViewportType.STACK,
        element,
        defaultOptions: {
          background: [0, 0, 0],
          // Show the volume in the plane it was acquired in, so one slice per
          // stored slice (matching the scrub bar's count).
          ...(volume ? { orientation: Enums.OrientationAxis.ACQUISITION } : {}),
        },
      })

      const toolGroup = ensureToolGroup()
      toolGroup.addViewport(VIEWPORT_ID, RENDERING_ENGINE_ID)

      const viewport = engine.getViewport(VIEWPORT_ID) as ViewerViewport
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
  }, [volume])

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
        const viewport = engine.getViewport(VIEWPORT_ID) as ViewerViewport | undefined
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

  // Report the current slice as the user scrolls.
  useEffect(() => {
    const element = elementRef.current
    if (!element) return
    if (volume) {
      const report = () => {
        const viewport = engineRef.current?.getViewport(VIEWPORT_ID) as
          | Types.IVolumeViewport
          | undefined
        const idx = viewport?.getSliceIndex?.()
        if (typeof idx === 'number' && idx >= 0) onIndexChange?.(idx)
      }
      element.addEventListener(Enums.Events.VOLUME_NEW_IMAGE, report)
      element.addEventListener(Enums.Events.CAMERA_MODIFIED, report)
      return () => {
        element.removeEventListener(Enums.Events.VOLUME_NEW_IMAGE, report)
        element.removeEventListener(Enums.Events.CAMERA_MODIFIED, report)
      }
    }
    const handler = (evt: Event) => {
      const detail = (evt as CustomEvent).detail as {
        imageIdIndex?: number
        newImageIdIndex?: number
      }
      const idx = detail?.newImageIdIndex ?? detail?.imageIdIndex
      if (typeof idx === 'number') onIndexChange?.(idx)
    }
    element.addEventListener(Enums.Events.STACK_NEW_IMAGE, handler)
    return () => element.removeEventListener(Enums.Events.STACK_NEW_IMAGE, handler)
  }, [volume, onIndexChange])

  // Report images that fail to load or decode.
  useEffect(() => {
    const handler = (evt: Event) => {
      const imageId = (evt as CustomEvent<{ imageId?: string }>).detail?.imageId
      if (imageId && imageIds.includes(imageId)) onLoadError?.(imageId)
    }
    eventTarget.addEventListener(Enums.Events.IMAGE_LOAD_ERROR, handler)
    return () => eventTarget.removeEventListener(Enums.Events.IMAGE_LOAD_ERROR, handler)
  }, [imageIds, onLoadError])

  // Load / replace the images whenever the imageIds change.
  useEffect(() => {
    let cancelled = false
    async function load() {
      await initCornerstone()
      const engine = engineRef.current
      if (!engine || cancelled || imageIds.length === 0) return
      const viewport = engine.getViewport(VIEWPORT_ID) as ViewerViewport
      if (!viewport) return
      let initialIndex = 0
      try {
        if (isVolumeViewport(viewport)) {
          const volumeId = niftiVolumeId(imageIds[0])
          const vol =
            cache.getVolume(volumeId) ??
            (await volumeLoader.createAndCacheVolume(volumeId, { imageIds }))
          if (cancelled) return
          vol.load(() => {})
          await viewport.setVolumes([{ volumeId }], true)
          if (cancelled) return
          // Apply the robust window computed from the file's voxels; the
          // volume's own default (middle-slice min/max) leaves sparse maps
          // near-black.
          const voi = niftiVoiRange(imageIds[0])
          if (voi) viewport.setProperties({ voiRange: voi }, volumeId)
          // A volume opens on its middle slice — where the anatomy is — like
          // other NIfTI viewers, rather than the near-empty first slice.
          initialIndex = viewport.getSliceIndex()
        } else {
          await viewport.setStack(imageIds, 0)
        }
      } catch (err) {
        if (cancelled) return
        console.error(err)
        onLoadError?.(imageIds[0])
        return
      }
      // A newer set was requested while this one loaded; let that one win.
      if (cancelled) return
      viewport.render()
      onIndexChange?.(initialIndex)
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

/** The current slice index, for either viewport type. */
export function getViewportIndex(viewport: ViewerViewport | null): number {
  if (!viewport) return 0
  try {
    return isVolumeViewport(viewport)
      ? viewport.getSliceIndex()
      : viewport.getCurrentImageIdIndex()
  } catch {
    return 0
  }
}

/** Imperatively move either viewport type to a given slice index. */
export function setViewportIndex(viewport: ViewerViewport | null, index: number) {
  if (!viewport) return
  try {
    if (isVolumeViewport(viewport)) {
      void csUtils.jumpToSlice(viewport.element, { imageIndex: index })
    } else {
      viewport.setImageIdIndex(index)
    }
  } catch {
    /* index out of range during rapid updates — ignore */
  }
}

export { VIEWPORT_ID, RENDERING_ENGINE_ID }
