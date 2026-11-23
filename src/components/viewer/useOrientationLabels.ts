import { useEffect, useState } from 'react'
import { Enums } from '@cornerstonejs/core'
import { getImageTags } from '@/lib/cornerstone/loadDicom'
import type { AnyViewport } from '@/lib/cornerstone/viewportNav'
import {
  lpsLabel,
  patientOrientationLabel,
  screenLabels,
  type ScreenLabels,
  type Vec3,
} from '@/lib/dicom/geometry'

function sameLabels(a: ScreenLabels | null, b: ScreenLabels | null): boolean {
  return (
    a === b ||
    (!!a && !!b && a.top === b.top && a.bottom === b.bottom && a.left === b.left && a.right === b.right)
  )
}

/**
 * Patient-direction labels for the screen edges of the current image, or null
 * when the image carries no orientation information. Recomputed whenever the
 * camera changes, so flips and rotations are reflected.
 */
export function useOrientationLabels(
  viewport: AnyViewport | null,
  imageId: string | undefined,
): ScreenLabels | null {
  const [labels, setLabels] = useState<ScreenLabels | null>(null)

  useEffect(() => {
    const tags = imageId ? getImageTags(imageId) : undefined
    const patientOrientation = tags?.patientOrientation
    const label = tags?.imageOrientation
      ? lpsLabel
      : patientOrientation
        ? (v: Vec3) => patientOrientationLabel(v, patientOrientation)
        : null

    const update = () => {
      const camera = viewport?.getCamera()
      const next =
        label && camera?.viewUp && camera.viewPlaneNormal
          ? screenLabels(camera.viewUp as Vec3, camera.viewPlaneNormal as Vec3, label)
          : null
      setLabels((prev) => (sameLabels(prev, next) ? prev : next))
    }

    update()
    const element = viewport?.element
    element?.addEventListener(Enums.Events.CAMERA_MODIFIED, update)
    return () => element?.removeEventListener(Enums.Events.CAMERA_MODIFIED, update)
  }, [viewport, imageId])

  return labels
}
