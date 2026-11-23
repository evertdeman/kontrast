/**
 * Slice navigation that works for both viewport kinds: a stack viewport (DICOM,
 * one image per slice) and a volume viewport (NIfTI, slices along the
 * acquisition axis). The viewer drives both through these helpers.
 */
import { Enums, type Types } from '@cornerstonejs/core'

/** Either viewport the app renders into: a DICOM stack or a NIfTI volume. */
export type AnyViewport = Types.IStackViewport | Types.IVolumeViewport

export function isVolumeViewport(viewport: AnyViewport): viewport is Types.IVolumeViewport {
  return viewport.type === Enums.ViewportType.ORTHOGRAPHIC
}

/** The current slice index. */
export function currentSlice(viewport: AnyViewport): number {
  return isVolumeViewport(viewport)
    ? viewport.getSliceIndex()
    : viewport.getCurrentImageIdIndex()
}

/** Move to a slice index, guarded against rapid out-of-range updates. */
export function gotoSlice(viewport: AnyViewport, index: number) {
  try {
    if (isVolumeViewport(viewport)) {
      // scroll by the delta — setViewReference needs a matching frame of reference.
      const delta = index - viewport.getSliceIndex()
      if (delta !== 0) viewport.scroll(delta)
    } else {
      viewport.setImageIdIndex(index)
    }
  } catch {
    /* index out of range during rapid updates — ignore */
  }
}
