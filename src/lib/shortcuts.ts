/** Viewer keyboard shortcuts, shared by the viewer, its toolbar and the landing page. */
import type { PrimaryTool } from '@/lib/cornerstone/toolGroup'

export const TOOL_KEYS: Record<PrimaryTool, string> = {
  WindowLevel: 'W',
  Pan: 'P',
  Zoom: 'Z',
  StackScroll: 'S',
  Length: 'L',
}

export const ACTION_KEYS = {
  invert: 'I',
  reset: 'R',
  header: 'H',
  panel: 'T',
  play: 'Space',
  prev: '↑',
  next: '↓',
} as const

/** True when a key event should go to a text field or open dialog instead. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
    target.closest('[role="dialog"]') !== null
  )
}
