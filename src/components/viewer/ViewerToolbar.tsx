import type { ComponentType } from 'react'
import {
  Contrast,
  Hand,
  Search,
  Layers,
  Ruler,
  FlipHorizontal2,
  RotateCcw,
  Camera,
  PanelRightClose,
  PanelRightOpen,
  DraftingCompass,
  Circle,
  SlidersHorizontal,
  ChevronDown,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { WindowPreset } from '@/lib/cornerstone/windowing'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { PrimaryTool } from '@/lib/cornerstone/toolGroup'
import { Kbd } from '@/components/ui/kbd'
import { ACTION_KEYS, TOOL_KEYS } from '@/lib/shortcuts'

interface ViewerToolbarProps {
  activeTool: PrimaryTool
  onToolChange: (tool: PrimaryTool) => void
  onInvert: () => void
  onReset: () => void
  onScreenshot: () => void
  /** Window presets for the current series; the menu is hidden when empty. */
  presets: WindowPreset[]
  onPreset: (preset: WindowPreset) => void
  inspectorCollapsed: boolean
  onToggleInspector: () => void
}

type ToolButton = {
  id: PrimaryTool
  label: string
  Icon: ComponentType<{ className?: string }>
}

/** Tools for looking around the image. */
const VIEW_TOOLS: ToolButton[] = [
  { id: 'WindowLevel', label: 'Window / Level', Icon: Contrast },
  { id: 'Pan', label: 'Pan', Icon: Hand },
  { id: 'Zoom', label: 'Zoom', Icon: Search },
  { id: 'StackScroll', label: 'Scroll stack', Icon: Layers },
]

/** Tools that draw measurements on the image. */
const MEASURE_TOOLS: ToolButton[] = [
  { id: 'Length', label: 'Length measurement', Icon: Ruler },
  { id: 'Angle', label: 'Angle measurement', Icon: DraftingCompass },
  { id: 'EllipticalROI', label: 'Elliptical region', Icon: Circle },
]

const Divider = () => <div aria-hidden className="mx-1.5 h-5 w-px bg-line-strong" />

function Hint({ label, shortcut }: { label: string; shortcut?: string }) {
  return (
    <span className="flex items-center gap-2">
      {label}
      {shortcut && (
        <Kbd className="h-4 min-w-4 border-current/30 bg-transparent text-[10px] text-current">
          {shortcut}
        </Kbd>
      )}
    </span>
  )
}

function IconButton({
  label,
  shortcut,
  active,
  onClick,
  Icon,
}: {
  label: string
  shortcut: string
  active?: boolean
  onClick: () => void
  Icon: ComponentType<{ className?: string }>
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          className={cn(
            'flex size-9 items-center justify-center rounded-lg transition-colors',
            active
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-elevated hover:text-foreground',
          )}
        >
          <Icon className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <Hint label={label} shortcut={shortcut} />
      </TooltipContent>
    </Tooltip>
  )
}

export function ViewerToolbar({
  activeTool,
  onToolChange,
  onInvert,
  onReset,
  onScreenshot,
  presets,
  onPreset,
  inspectorCollapsed,
  onToggleInspector,
}: ViewerToolbarProps) {
  return (
    <div
      role="toolbar"
      aria-label="Tools"
      className="flex h-12 flex-none flex-wrap items-center gap-1 border-b border-line px-2"
    >
      {[VIEW_TOOLS, MEASURE_TOOLS].map((group, i) => (
        <div key={i} className="contents">
          {group.map(({ id, label, Icon }) => (
            <IconButton
              key={id}
              label={label}
              shortcut={TOOL_KEYS[id]}
              Icon={Icon}
              active={activeTool === id}
              onClick={() => onToolChange(id)}
            />
          ))}
          <Divider />
        </div>
      ))}

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" onClick={onInvert} aria-label="Invert">
            <FlipHorizontal2 className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <Hint label="Invert" shortcut={ACTION_KEYS.invert} />
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" onClick={onReset} aria-label="Reset view">
            <RotateCcw className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <Hint label="Reset view" shortcut={ACTION_KEYS.reset} />
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" onClick={onScreenshot} aria-label="Save screenshot">
            <Camera className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <Hint label="Save screenshot" shortcut={ACTION_KEYS.screenshot} />
        </TooltipContent>
      </Tooltip>

      {presets.length > 0 && (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="text-[13px]">
                  <SlidersHorizontal className="size-4" />
                  Presets
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <Hint
                label="CT window presets"
                shortcut={`${presets[0].key}–${presets[presets.length - 1].key}`}
              />
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start" className="min-w-56">
            {presets.map((preset) => (
              <DropdownMenuItem key={preset.name} onSelect={() => onPreset(preset)}>
                <span className="flex-1">{preset.name}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  W {preset.ww} L {preset.wl}
                </span>
                <Kbd className="ml-2">{preset.key}</Kbd>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <div className="flex-1" />

      <div className="flex items-center gap-1 rounded-lg border border-line-strong p-0.5">
        <span className="flex h-7 items-center gap-1.5 rounded-md bg-secondary px-2.5 text-[13px]">
          <Layers className="size-3.5" />
          Stack
        </span>
        <span
          className="flex h-7 cursor-not-allowed items-center gap-1.5 rounded-md px-2.5 text-[13px] text-faint"
          title="MPR — coming soon"
        >
          MPR
        </span>
      </div>

      <Divider />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleInspector}
            aria-label={inspectorCollapsed ? 'Show header panel' : 'Hide header panel'}
            aria-pressed={!inspectorCollapsed}
          >
            {inspectorCollapsed ? (
              <PanelRightOpen className="size-4" />
            ) : (
              <PanelRightClose className="size-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <Hint
            label={inspectorCollapsed ? 'Show header panel' : 'Hide header panel'}
            shortcut={ACTION_KEYS.panel}
          />
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
