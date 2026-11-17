import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  clampInspectorWidth,
  INSPECTOR_MAX_WIDTH,
  INSPECTOR_MIN_WIDTH,
} from './useInspectorLayout'

describe('clampInspectorWidth', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('keeps widths within the minimum and maximum', () => {
    vi.stubGlobal('window', { innerWidth: 2560 })
    expect(clampInspectorWidth(100)).toBe(INSPECTOR_MIN_WIDTH)
    expect(clampInspectorWidth(400)).toBe(400)
    expect(clampInspectorWidth(5000)).toBe(INSPECTOR_MAX_WIDTH)
  })

  test('leaves room for the series rail and viewport on narrow windows', () => {
    vi.stubGlobal('window', { innerWidth: 1000 })
    expect(clampInspectorWidth(700)).toBe(480)
  })

  test('never goes below the minimum, even on very narrow windows', () => {
    vi.stubGlobal('window', { innerWidth: 600 })
    expect(clampInspectorWidth(500)).toBe(INSPECTOR_MIN_WIDTH)
  })

  test('rounds to whole pixels', () => {
    vi.stubGlobal('window', { innerWidth: 2560 })
    expect(clampInspectorWidth(321.6)).toBe(322)
  })
})
