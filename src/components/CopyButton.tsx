import { toast } from 'sonner'
import { Copy } from 'lucide-react'
import { cn } from '@/lib/utils'

/** A small button that copies `value` to the clipboard, labelled for screen readers. */
export function CopyButton({ value, label, className }: { value: string; label: string; className?: string }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      toast.success('Copied to the clipboard.')
    } catch {
      toast.error('Could not copy to the clipboard.')
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      className={cn(
        'flex-none rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground',
        className,
      )}
    >
      <Copy className="size-3.5" />
    </button>
  )
}
