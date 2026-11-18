import { describe, expect, test, vi } from 'vitest'
import { ToolGroupManager } from '@cornerstonejs/tools'
import { ensureToolGroup, setPrimaryTool } from './toolGroup'

vi.mock('@cornerstonejs/tools', () => {
  const group = {
    addTool: vi.fn(),
    setToolActive: vi.fn(),
    setToolPassive: vi.fn(),
  }
  let created = false
  const tool = (toolName: string) => ({ toolName })
  return {
    ToolGroupManager: {
      getToolGroup: vi.fn(() => (created ? group : undefined)),
      createToolGroup: vi.fn(() => {
        created = true
        return group
      }),
    },
    WindowLevelTool: tool('WindowLevel'),
    PanTool: tool('Pan'),
    ZoomTool: tool('Zoom'),
    StackScrollTool: tool('StackScroll'),
    LengthTool: tool('Length'),
    Enums: { MouseBindings: { Primary: 1, Secondary: 2, Auxiliary: 4, Wheel: 524288 } },
  }
})

type Group = ReturnType<typeof ensureToolGroup> & {
  setToolActive: ReturnType<typeof vi.fn>
  setToolPassive: ReturnType<typeof vi.fn>
}

/** Mouse buttons each tool was last made active with; [] when passive. */
function bindings(group: Group): Record<string, number[]> {
  const out: Record<string, number[]> = {}
  for (const [name, opts] of group.setToolActive.mock.calls) {
    out[name] = opts.bindings.map((b: { mouseButton: number }) => b.mouseButton)
  }
  for (const [name] of group.setToolPassive.mock.calls) out[name] = []
  return out
}

describe('tool group', () => {
  test('starts with window/level on the left button and fixed bindings for the rest', () => {
    const group = ensureToolGroup() as Group
    expect(bindings(group)).toEqual({
      WindowLevel: [1],
      Pan: [4],
      Zoom: [2],
      StackScroll: [524288],
      Length: [],
    })
    expect(ensureToolGroup()).toBe(group)
    expect(ToolGroupManager.createToolGroup).toHaveBeenCalledOnce()
  })

  test('moves the left button to the chosen tool, keeping its other bindings', () => {
    const group = ensureToolGroup() as Group
    group.setToolActive.mockClear()
    group.setToolPassive.mockClear()
    setPrimaryTool('Pan')
    expect(bindings(group)).toEqual({
      WindowLevel: [],
      Pan: [4, 1],
      Zoom: [2],
      StackScroll: [524288],
      Length: [],
    })
  })
})
