/**
 * Patient-space geometry helpers: slice ordering and orientation labels.
 * Pure functions, no Cornerstone dependency.
 */

export type Vec3 = [number, number, number]

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

export function negate(v: Vec3): Vec3 {
  return [-v[0], -v[1], -v[2]]
}

/** Parse a DICOM multi-value decimal string (e.g. "1\\0\\0") into numbers. */
export function parseDecimals(raw: string | undefined, length: number): number[] | null {
  if (!raw) return null
  const values = raw.split('\\').map((s) => Number(s.trim()))
  if (values.length !== length || values.some((n) => !Number.isFinite(n))) return null
  return values
}

// ---------------------------------------------------------------------------
// Slice ordering
// ---------------------------------------------------------------------------

export interface SliceGeometry {
  /** ImageOrientationPatient: row cosines then column cosines. */
  orientation: number[] | null
  /** ImagePositionPatient. */
  position: number[] | null
  instanceNumber: number | null
}

const ORIENTATION_TOLERANCE = 1e-2

function sameOrientation(a: number[], b: number[]): boolean {
  return a.every((v, i) => Math.abs(v - b[i]) < ORIENTATION_TOLERANCE)
}

/**
 * Order the slices of one series. Parallel slices with known geometry are
 * sorted by their position along the slice normal, in the direction that
 * agrees with InstanceNumber; everything else falls back to InstanceNumber.
 * Both sorts are stable, so ties (e.g. several time points at one position)
 * keep their InstanceNumber order.
 */
export function sortSlices<T>(items: T[], geometryOf: (item: T) => SliceGeometry): T[] {
  const byInstance = [...items].sort((a, b) => {
    const ai = geometryOf(a).instanceNumber
    const bi = geometryOf(b).instanceNumber
    if (ai == null || bi == null) return (ai == null ? 1 : 0) - (bi == null ? 1 : 0)
    return ai - bi
  })
  if (byInstance.length < 2) return byInstance

  const geometries = byInstance.map(geometryOf)
  const reference = geometries[0].orientation
  const parallel =
    reference != null &&
    geometries.every(
      (g) => g.position && g.orientation && sameOrientation(g.orientation, reference),
    )
  if (!parallel) return byInstance

  const normal = cross(reference.slice(0, 3) as Vec3, reference.slice(3, 6) as Vec3)
  const distance = new Map(
    byInstance.map((item, i) => [item, dot(geometries[i].position as Vec3, normal)]),
  )
  const first = distance.get(byInstance[0])!
  const last = distance.get(byInstance[byInstance.length - 1])!
  const direction = first > last ? -1 : 1
  return byInstance.sort((a, b) => direction * (distance.get(a)! - distance.get(b)!))
}

// ---------------------------------------------------------------------------
// Orientation labels
// ---------------------------------------------------------------------------

/** Components smaller than this are left out of oblique labels. */
const LABEL_THRESHOLD = 0.25

const OPPOSITE: Record<string, string> = {
  L: 'R', R: 'L', A: 'P', P: 'A', H: 'F', F: 'H', S: 'I', I: 'S',
}

/** Combine per-axis labels, strongest component first ("L", "LA", "LAH"). */
function combine(v: Vec3, axisLabel: (axis: number, positive: boolean) => string): string {
  return [0, 1, 2]
    .filter((i) => Math.abs(v[i]) >= LABEL_THRESHOLD)
    .sort((a, b) => Math.abs(v[b]) - Math.abs(v[a]))
    .map((i) => axisLabel(i, v[i] > 0))
    .join('')
}

/** Label a direction in the DICOM patient coordinate system (LPS). */
export function lpsLabel(v: Vec3): string {
  const AXES = [['R', 'L'], ['A', 'P'], ['F', 'H']]
  return combine(v, (axis, positive) => AXES[axis][positive ? 1 : 0])
}

/**
 * Label a direction in image space using PatientOrientation (0020,0020),
 * which gives the patient direction of the image rows and columns. Used for
 * projection images (X-ray) that have no ImageOrientationPatient. Image space
 * matches Cornerstone's default: +x along rows, +y down the columns.
 */
export function patientOrientationLabel(v: Vec3, orientation: [string, string]): string {
  const flip = (label: string) => [...label].map((c) => OPPOSITE[c] ?? c).join('')
  return combine([v[0], v[1], 0], (axis, positive) =>
    positive ? orientation[axis] : flip(orientation[axis]),
  )
}

export interface ScreenLabels {
  top: string
  bottom: string
  left: string
  right: string
}

/**
 * Labels for the four screen edges, given the camera's viewUp and
 * viewPlaneNormal (which already include any flip or rotation).
 */
export function screenLabels(
  viewUp: Vec3,
  viewPlaneNormal: Vec3,
  label: (v: Vec3) => string,
): ScreenLabels {
  const viewRight = cross(viewUp, viewPlaneNormal)
  return {
    top: label(viewUp),
    bottom: label(negate(viewUp)),
    right: label(viewRight),
    left: label(negate(viewRight)),
  }
}
