import { useEffect, useMemo, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { getImageFile } from '@/lib/cornerstone/loadDicom'
import { readHeaderRows, type HeaderRow } from '@/lib/dicom/header'

interface HeaderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  imageId: string
  description: string
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; rows: HeaderRow[] }

const COLS = 'grid-cols-[104px_36px_minmax(0,1fr)_minmax(0,1.6fr)]'

function matches(row: HeaderRow, q: string): boolean {
  const compactTag = row.tag.replace(/[(),]/g, '').toLowerCase()
  return (
    row.tag.toLowerCase().includes(q) ||
    compactTag.includes(q.replace(/[(),\s]/g, '')) ||
    row.name.toLowerCase().includes(q) ||
    row.vr.toLowerCase() === q ||
    row.value.toLowerCase().includes(q)
  )
}

export function HeaderDialog({
  open,
  onOpenChange,
  imageId,
  description,
}: HeaderDialogProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const file = getImageFile(imageId)
    if (!file) {
      setState({ status: 'error', message: 'Source file is no longer available.' })
      return
    }
    setState({ status: 'loading' })
    readHeaderRows(file).then(
      (rows) => !cancelled && setState({ status: 'ready', rows }),
      (err: unknown) =>
        !cancelled &&
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : 'Could not parse header.',
        }),
    )
    return () => {
      cancelled = true
    }
  }, [open, imageId])

  const q = query.trim().toLowerCase()
  const rows = useMemo(() => (state.status === 'ready' ? state.rows : []), [state])
  const visible = useMemo(
    () => (q ? rows.filter((r) => r.kind !== 'item' && matches(r, q)) : rows),
    [rows, q],
  )
  const elementCount = useMemo(
    () => rows.filter((r) => r.kind !== 'item').length,
    [rows],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] flex-col gap-3 p-0 sm:max-w-5xl">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle>DICOM header</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3 px-5">
          <label className="flex h-9 flex-1 items-center gap-2 rounded-lg border border-line-strong px-2.5 text-muted-foreground">
            <Search className="size-3.5" />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tag, keyword or value"
              aria-label="Search header"
              className="w-full bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
            />
          </label>
          {state.status === 'ready' && (
            <span className="flex-none font-mono text-xs text-muted-foreground">
              {q ? `${visible.length} / ${elementCount}` : `${elementCount} elements`}
            </span>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto border-t border-line">
          <div
            className={cn(
              'sticky top-0 z-10 grid gap-3 border-b border-line bg-background px-5 py-2 text-xs text-muted-foreground',
              COLS,
            )}
          >
            <span>Tag</span>
            <span>VR</span>
            <span>Keyword</span>
            <span>Value</span>
          </div>

          {state.status === 'loading' && (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Reading header
            </div>
          )}
          {state.status === 'error' && (
            <p className="py-12 text-center text-sm text-destructive">{state.message}</p>
          )}
          {state.status === 'ready' && visible.length === 0 && (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No elements match “{query}”.
            </p>
          )}

          {visible.map((row) => (
            <div
              key={row.id}
              className={cn(
                'grid gap-3 border-b border-line/60 px-5 py-1.5 text-[13px]',
                COLS,
                row.kind === 'item' && 'bg-card text-muted-foreground',
              )}
            >
              <span className="font-mono text-xs text-muted-foreground">
                {row.kind === 'item' ? '' : row.tag}
              </span>
              <span className="font-mono text-xs text-muted-foreground">{row.vr}</span>
              <span
                className={cn('truncate', row.kind === 'sequence' && 'font-medium')}
                style={{ paddingLeft: `${row.depth * 12}px` }}
                title={row.name}
              >
                {row.name || <span className="text-muted-foreground">Unknown</span>}
              </span>
              <span className="font-mono text-xs break-all whitespace-pre-wrap">
                {row.value}
              </span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
