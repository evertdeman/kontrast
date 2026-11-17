/** Window/level readout and screenshot helpers. */
import type { Types } from '@cornerstonejs/core'

/** Read the viewport's current WW/WL from its voiRange, if available. */
export function currentWindow(
  viewport: Types.IStackViewport,
): { ww: number; wl: number } | null {
  const range = viewport.getProperties()?.voiRange
  if (!range) return null
  const ww = Math.round(range.upper - range.lower)
  const wl = Math.round((range.upper + range.lower) / 2)
  return { ww, wl }
}

/** Download the current viewport canvas as a PNG. Stays fully client-side. */
export function saveScreenshot(
  viewport: Types.IStackViewport,
  filename = 'kontrast-capture.png',
) {
  const canvas = viewport.getCanvas()
  if (!canvas) return
  const url = canvas.toDataURL('image/png')
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
}
