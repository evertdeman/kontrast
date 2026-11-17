import { describe, expect, test } from 'vitest'
import {
  cross,
  lpsLabel,
  negate,
  patientOrientationLabel,
  screenLabels,
  sortSlices,
  type SliceGeometry,
  type Vec3,
} from './geometry'

// Mirrors StackViewport._getCameraOrientation: viewPlaneNormal = -(row × col), viewUp = -col.
function labelsFor(row: Vec3, col: Vec3, label = lpsLabel) {
  return screenLabels(negate(col), negate(cross(row, col)), label)
}

describe('screen labels', () => {
  test('axial', () => {
    expect(labelsFor([1, 0, 0], [0, 1, 0])).toEqual({ top: 'A', bottom: 'P', left: 'R', right: 'L' })
  })

  test('sagittal', () => {
    expect(labelsFor([0, 1, 0], [0, 0, -1])).toEqual({ top: 'H', bottom: 'F', left: 'A', right: 'P' })
  })

  test('coronal', () => {
    expect(labelsFor([1, 0, 0], [0, 0, -1])).toEqual({ top: 'H', bottom: 'F', left: 'R', right: 'L' })
  })

  test('horizontal flip swaps left and right', () => {
    const row: Vec3 = [1, 0, 0]
    const col: Vec3 = [0, 1, 0]
    // Viewport.flip negates the view plane normal and keeps viewUp.
    expect(screenLabels(negate(col), cross(row, col), lpsLabel)).toEqual({
      top: 'A',
      bottom: 'P',
      left: 'L',
      right: 'R',
    })
  })

  test('projection image uses PatientOrientation', () => {
    const label = (v: Vec3) => patientOrientationLabel(v, ['R', 'F'])
    expect(labelsFor([1, 0, 0], [0, 1, 0], label)).toEqual({ top: 'H', bottom: 'F', left: 'L', right: 'R' })
  })

  test('multi-letter PatientOrientation is inverted letter by letter', () => {
    expect(patientOrientationLabel([-1, 0, 0], ['AL', 'F'])).toBe('PR')
  })
})

describe('lpsLabel', () => {
  test.each([
    [[1, 0, 0], 'L'],
    [[0, -1, 0], 'A'],
    [[0, 0, 1], 'H'],
    [[0.99, 0.1, 0], 'L'],
    [[0.9, 0.4, 0], 'LP'],
    [[-0.4, 0, -0.9], 'FR'],
  ] as [Vec3, string][])('%j → %s', (v, expected) => {
    expect(lpsLabel(v)).toBe(expected)
  })
})

describe('sortSlices', () => {
  const SAGITTAL = [0, 1, 0, 0, 0, -1]

  function slice(id: number, position: number[] | null, instanceNumber: number | null, orientation: number[] | null = SAGITTAL) {
    return { id, geometry: { orientation, position, instanceNumber } satisfies SliceGeometry }
  }

  function order(items: ReturnType<typeof slice>[]) {
    return sortSlices(items, (s) => s.geometry).map((s) => s.id)
  }

  test('sorts by position along the slice normal, not by z or instance number', () => {
    const items = [slice(1, [10, 0, 0], 1), slice(2, [30, 0, 0], 2), slice(3, [20, 0, 0], 3), slice(4, [0, 0, 0], 4)]
    expect(order(items)).toEqual([2, 3, 1, 4])
  })

  test('direction follows instance numbers', () => {
    expect(order([slice(1, [0, 0, 0], 1), slice(2, [10, 0, 0], 2), slice(3, [20, 0, 0], 3)])).toEqual([1, 2, 3])
    expect(order([slice(1, [20, 0, 0], 1), slice(2, [10, 0, 0], 2), slice(3, [0, 0, 0], 3)])).toEqual([1, 2, 3])
  })

  test('slices at the same position keep instance order', () => {
    const items = [slice(1, [0, 0, 0], 2), slice(2, [0, 0, 0], 1), slice(3, [10, 0, 0], 3), slice(4, [10, 0, 0], 4)]
    expect(order(items)).toEqual([2, 1, 3, 4])
  })

  test('mixed orientations fall back to instance number', () => {
    const items = [slice(1, [0, 0, 0], 2, [1, 0, 0, 0, 1, 0]), slice(2, [5, 0, 0], 1), slice(3, [9, 0, 0], 3)]
    expect(order(items)).toEqual([2, 1, 3])
  })

  test('missing geometry falls back to instance number, missing numbers last', () => {
    expect(order([slice(1, null, null), slice(2, null, 2), slice(3, null, 1)])).toEqual([3, 2, 1])
  })
})
