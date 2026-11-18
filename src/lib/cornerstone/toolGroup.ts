/**
 * Tool-group setup for the stack viewport.
 *
 * Mouse model (matches the viewer mock-up):
 *   - middle drag  → Pan        (always)
 *   - right drag   → Zoom       (always)
 *   - wheel        → scroll stack (always)
 *   - left drag    → the "active" tool chosen in the toolbar
 */
import {
  ToolGroupManager,
  WindowLevelTool,
  PanTool,
  ZoomTool,
  StackScrollTool,
  LengthTool,
  AngleTool,
  EllipticalROITool,
  Enums as ToolEnums,
} from '@cornerstonejs/tools'

const { MouseBindings } = ToolEnums

export const TOOL_GROUP_ID = 'dicom-viewer-toolgroup'

/** Tools the user can put on the LEFT mouse button via the toolbar. */
export type PrimaryTool =
  | 'WindowLevel'
  | 'Pan'
  | 'Zoom'
  | 'StackScroll'
  | 'Length'
  | 'Angle'
  | 'EllipticalROI'

const NAME: Record<PrimaryTool, string> = {
  WindowLevel: WindowLevelTool.toolName,
  Pan: PanTool.toolName,
  Zoom: ZoomTool.toolName,
  StackScroll: StackScrollTool.toolName,
  Length: LengthTool.toolName,
  Angle: AngleTool.toolName,
  EllipticalROI: EllipticalROITool.toolName,
}

/** Permanent (non-left) bindings each tool keeps regardless of selection. */
const BASE_BINDINGS: Record<PrimaryTool, number[]> = {
  WindowLevel: [],
  Pan: [MouseBindings.Auxiliary],
  Zoom: [MouseBindings.Secondary],
  StackScroll: [MouseBindings.Wheel],
  Length: [],
  Angle: [],
  EllipticalROI: [],
}

export function ensureToolGroup() {
  const existing = ToolGroupManager.getToolGroup(TOOL_GROUP_ID)
  if (existing) return existing

  const toolGroup = ToolGroupManager.createToolGroup(TOOL_GROUP_ID)!
  for (const name of Object.values(NAME)) toolGroup.addTool(name)

  applyPrimary(toolGroup, 'WindowLevel')
  return toolGroup
}

function applyPrimary(
  toolGroup: ReturnType<typeof ensureToolGroup>,
  primary: PrimaryTool,
) {
  ;(Object.keys(NAME) as PrimaryTool[]).forEach((tool) => {
    const bindings = [...BASE_BINDINGS[tool]]
    if (tool === primary) bindings.push(MouseBindings.Primary)
    if (bindings.length > 0) {
      toolGroup.setToolActive(NAME[tool], {
        bindings: bindings.map((mouseButton) => ({ mouseButton })),
      })
    } else {
      toolGroup.setToolPassive(NAME[tool])
    }
  })
}

/** Rebind the left mouse button to the chosen tool. */
export function setPrimaryTool(tool: PrimaryTool) {
  const toolGroup = ToolGroupManager.getToolGroup(TOOL_GROUP_ID)
  if (toolGroup) applyPrimary(toolGroup, tool)
}
