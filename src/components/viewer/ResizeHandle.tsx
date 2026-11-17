import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { cn } from '@/lib/utils'
import {
  INSPECTOR_DEFAULT_WIDTH,
  INSPECTOR_MAX_WIDTH,
  INSPECTOR_MIN_WIDTH,
} from '@/components/viewer/useInspectorLayout'

interface ResizeHandleProps {
  width: number
  onWidthChange: (width: number) => void
  className?: string
}

const KEYBOARD_STEP = 16

/**
 * Drag handle on the left edge of the inspector. Dragging left widens the
 * panel; arrow keys nudge it; double-click restores the default width.
 */
export function ResizeHandle({ width, onWidthChange, className }: ResizeHandleProps) {
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const handle = e.currentTarget
    const startX = e.clientX
    const startWidth = width
    handle.setPointerCapture(e.pointerId)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev: PointerEvent) => onWidthChange(startWidth + (startX - ev.clientX))
    const onEnd = () => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onEnd)
      handle.removeEventListener('pointercancel', onEnd)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onEnd)
    handle.addEventListener('pointercancel', onEnd)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') onWidthChange(width + KEYBOARD_STEP)
    else if (e.key === 'ArrowRight') onWidthChange(width - KEYBOARD_STEP)
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize header panel"
      aria-valuenow={width}
      aria-valuemin={INSPECTOR_MIN_WIDTH}
      aria-valuemax={INSPECTOR_MAX_WIDTH}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onWidthChange(INSPECTOR_DEFAULT_WIDTH)}
      title="Drag to resize, double-click to reset"
      className={cn(
        'group absolute inset-y-0 -left-1.5 z-10 flex w-3 cursor-col-resize justify-center outline-none',
        className,
      )}
    >
      <div className="h-full w-px bg-transparent transition-colors group-hover:bg-ring group-focus-visible:bg-ring group-active:bg-ring" />
    </div>
  )
}
