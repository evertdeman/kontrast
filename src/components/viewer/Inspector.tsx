import { useMemo } from 'react'
import { FileText } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { HeaderDialog } from '@/components/viewer/HeaderDialog'
import { Kbd } from '@/components/ui/kbd'
import { ResizeHandle } from '@/components/viewer/ResizeHandle'
import { getImageMetadata } from '@/lib/cornerstone/metadata'
import { cn } from '@/lib/utils'

interface InspectorProps {
  imageId: string
  index: number
  total: number
  seriesDescription: string
  headerOpen: boolean
  onHeaderOpenChange: (open: boolean) => void
  width: number
  collapsed: boolean
  onWidthChange: (width: number) => void
}

export function Inspector({
  imageId,
  index,
  total,
  seriesDescription,
  headerOpen,
  onHeaderOpenChange,
  width,
  collapsed,
  onWidthChange,
}: InspectorProps) {
  const groups = useMemo(() => getImageMetadata(imageId), [imageId])

  return (
    // Stays mounted while collapsed so the full-header dialog (H) still works.
    <aside
      aria-label="Inspector"
      style={{ width }}
      className={cn(
        'relative flex flex-none flex-col border-l border-line bg-sidebar',
        collapsed && 'hidden',
      )}
    >
      <ResizeHandle width={width} onWidthChange={onWidthChange} />
      <ScrollArea className="min-h-0 flex-1">
        {groups.map((group, i) => (
          <div
            key={group.title}
            className={i === 0 ? 'flex flex-col gap-2.5 p-4' : 'flex flex-col gap-2.5 border-t border-line p-4'}
          >
            <div className="px-0.5 text-xs text-muted-foreground">{group.title}</div>
            <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2 px-0.5 text-[13px]">
              {group.fields.map((f) => (
                <div key={f.label} className="contents">
                  <dt className="text-muted-foreground">{f.label}</dt>
                  <dd className="font-mono text-xs leading-5 break-all">{f.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </ScrollArea>

      <div className="border-t border-line p-3">
        <button
          type="button"
          onClick={() => onHeaderOpenChange(true)}
          className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-line-strong bg-elevated text-[13px] font-medium transition-colors hover:brightness-110"
        >
          <FileText className="size-3.5" />
          View full header
          <Kbd className="ml-1">H</Kbd>
        </button>
      </div>

      <HeaderDialog
        open={headerOpen}
        onOpenChange={onHeaderOpenChange}
        imageId={imageId}
        description={`${seriesDescription} · image ${index + 1} of ${total}`}
      />
    </aside>
  )
}
