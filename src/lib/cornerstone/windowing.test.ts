import { describe, expect, test, vi } from 'vitest'
import type { Types } from '@cornerstonejs/core'
import { CT_PRESETS, applyWindow, currentWindow, presetsFor } from './windowing'

function fakeViewport() {
  let voiRange: Types.VOIRange | undefined
  return {
    getProperties: () => ({ voiRange }),
    setProperties: vi.fn((props: { voiRange: Types.VOIRange }) => {
      voiRange = props.voiRange
    }),
    render: vi.fn(),
  } as unknown as Types.IStackViewport & { render: ReturnType<typeof vi.fn> }
}

describe('window presets', () => {
  test('are offered for CT only', () => {
    expect(presetsFor('CT')).toBe(CT_PRESETS)
    expect(presetsFor('MR')).toEqual([])
  })

  test('have unique shortcuts', () => {
    expect(new Set(CT_PRESETS.map((p) => p.key)).size).toBe(CT_PRESETS.length)
  })

  test('applying one sets the window and renders', () => {
    const viewport = fakeViewport()
    applyWindow(viewport, { ww: 1500, wl: -600 })
    expect(currentWindow(viewport)).toEqual({ ww: 1500, wl: -600 })
    expect(viewport.render).toHaveBeenCalled()
  })
})
