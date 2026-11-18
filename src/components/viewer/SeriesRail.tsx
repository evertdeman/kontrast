import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { SeriesThumbnail } from '@/components/SeriesThumbnail'
import { cn } from '@/lib/utils'
import type { SeriesInfo } from '@/lib/cornerstone/studies'

interface SeriesRailProps {
  series: SeriesInfo[]
  activeSeriesUID: string
  onSelect: (seriesUID: string) => void
}

export function SeriesRail({ series, activeSeriesUID, onSelect }: SeriesRailProps) {
  const [filter, setFilter] = useState('')

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return series
    return series.filter((s) =>
      [s.description, s.modality, s.seriesNumber?.toString() ?? '']
        .join(' ')
        .toLowerCase()
        .includes(q),
    )
  }, [series, filter])

  return (
    <aside
      aria-label="Series"
      className="hidden w-[248px] flex-none flex-col border-r border-line md:flex"
    >
      <div className="border-b border-line p-3">
        <label className="flex h-[34px] items-center gap-2 rounded-lg border border-line-strong px-2.5 text-muted-foreground">
          <Search className="size-3.5" />
          <input
            type="text"
            placeholder="Filter series"
            aria-label="Filter series"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
      </div>
      <div className="flex justify-between px-3 pb-1.5 pt-3 text-xs text-muted-foreground">
        <span>Series</span>
        <span className="font-mono">{series.length}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pb-2">
        {visible.map((s) => {
          const active = s.seriesUID === activeSeriesUID
          return (
            <button
              key={s.seriesUID}
              type="button"
              aria-current={active ? 'true' : undefined}
              onClick={() => onSelect(s.seriesUID)}
              className={cn(
                'flex items-center gap-2.5 rounded-[10px] border p-2 text-left transition-colors',
                active
                  ? 'border-line-strong bg-elevated'
                  : 'border-transparent hover:bg-elevated/60',
              )}
            >
              <SeriesThumbnail imageIds={s.imageIds} className="size-14" />
              <div className="flex min-w-0 flex-col gap-1">
                <span className="truncate text-[13px] font-medium">
                  {s.description}
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {s.seriesNumber != null && `#${s.seriesNumber} · `}
                  {s.modality} · {s.imageIds.length} img
                </span>
              </div>
            </button>
          )
        })}
        {visible.length === 0 && (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            No series match “{filter}”.
          </p>
        )}
      </div>
    </aside>
  )
}
