import { useCallback, useEffect, useState } from 'react'

export const INSPECTOR_DEFAULT_WIDTH = 300
export const INSPECTOR_MIN_WIDTH = 240
export const INSPECTOR_MAX_WIDTH = 720
/** Space always left for the series rail and viewport. */
const RESERVED_WIDTH = 520

const STORAGE_KEY = 'kontrast.inspector'

interface InspectorLayout {
  width: number
  collapsed: boolean
}

export function clampInspectorWidth(width: number): number {
  const max = Math.min(INSPECTOR_MAX_WIDTH, window.innerWidth - RESERVED_WIDTH)
  return Math.round(Math.max(INSPECTOR_MIN_WIDTH, Math.min(max, width)))
}

function readLayout(): InspectorLayout {
  const fallback = { width: INSPECTOR_DEFAULT_WIDTH, collapsed: false }
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (typeof stored?.width !== 'number' || typeof stored?.collapsed !== 'boolean') return fallback
    return { width: clampInspectorWidth(stored.width), collapsed: stored.collapsed }
  } catch {
    return fallback
  }
}

/** Width and collapsed state of the header inspector, remembered per browser. */
export function useInspectorLayout() {
  const [layout, setLayout] = useState(readLayout)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layout))
    } catch {
      // Storage unavailable (private mode, blocked site data): keep it in memory.
    }
  }, [layout])

  // Keep the panel within bounds when the window shrinks.
  useEffect(() => {
    const onResize = () =>
      setLayout((l) => {
        const width = clampInspectorWidth(l.width)
        return width === l.width ? l : { ...l, width }
      })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const setWidth = useCallback(
    (width: number) => setLayout((l) => ({ ...l, width: clampInspectorWidth(width) })),
    [],
  )
  const toggleCollapsed = useCallback(
    () => setLayout((l) => ({ ...l, collapsed: !l.collapsed })),
    [],
  )

  return { ...layout, setWidth, toggleCollapsed }
}
