/** Window/level readout and screenshot helpers. */
import type { AnyViewport } from '@/lib/cornerstone/viewportNav'

/** Read the viewport's current WW/WL from its voiRange, if available. */
export function currentWindow(
  viewport: AnyViewport,
): { ww: number; wl: number } | null {
  const range = viewport.getProperties()?.voiRange
  if (!range) return null
  const ww = Math.round(range.upper - range.lower)
  const wl = Math.round((range.upper + range.lower) / 2)
  return { ww, wl }
}

export interface WindowPreset {
  name: string
  ww: number
  wl: number
  /** Keyboard shortcut. */
  key: string
}

/** Common CT windows, in Hounsfield units. */
export const CT_PRESETS: WindowPreset[] = [
  { name: 'Soft tissue', ww: 400, wl: 40, key: '1' },
  { name: 'Lung', ww: 1500, wl: -600, key: '2' },
  { name: 'Bone', ww: 1800, wl: 400, key: '3' },
  { name: 'Brain', ww: 80, wl: 40, key: '4' },
  { name: 'Subdural', ww: 200, wl: 75, key: '5' },
  { name: 'Liver', ww: 150, wl: 30, key: '6' },
]

/** Presets that make sense for a modality; only CT has a fixed (Hounsfield) scale. */
export function presetsFor(modality: string): WindowPreset[] {
  return modality.toUpperCase() === 'CT' ? CT_PRESETS : []
}

export function applyWindow(viewport: AnyViewport, { ww, wl }: { ww: number; wl: number }) {
  viewport.setProperties({ voiRange: { lower: wl - ww / 2, upper: wl + ww / 2 } })
  viewport.render()
}

/** Download the current viewport canvas as a PNG. Stays fully client-side. */
export function saveScreenshot(
  viewport: AnyViewport,
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
