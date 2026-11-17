import { Info } from 'lucide-react'
import { BrandMark } from '@/components/brand/BrandMark'
import { ThemeToggle } from '@/components/ThemeToggle'
import { FOOTER_LINKS, SITE } from '@/lib/site'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { StudyHeader } from '@/lib/cornerstone/metadata'

interface ViewerTopBarProps {
  header: StudyHeader
  onBack: () => void
}

export function ViewerTopBar({ header, onBack }: ViewerTopBarProps) {
  return (
    <header className="flex h-[52px] flex-none items-center justify-between gap-3 border-b border-line px-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <button
          type="button"
          onClick={onBack}
          aria-label={`${SITE.name} home`}
          className="flex-none"
        >
          <BrandMark />
        </button>
        <span className="text-line-strong">/</span>
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Studies
        </button>
        <span className="text-line-strong">/</span>
        <span className="truncate text-sm font-medium">
          {header.modality !== '—' ? `${header.modality} · ` : ''}
          {header.description}
        </span>
        {header.date !== '—' && (
          <span className="hidden rounded-md border border-line-strong px-1.5 py-px font-mono text-[11px] text-muted-foreground sm:inline">
            {header.date}
          </span>
        )}
      </div>
      <div className="flex flex-none items-center gap-2">
        <span className="hidden rounded-full border border-line-strong px-2.5 py-1 text-xs text-muted-foreground md:inline">
          Not for diagnostic use
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="About">
              <Info className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              Not a medical device. Not for diagnostic use.
            </p>
            {FOOTER_LINKS.map((link) => (
              <DropdownMenuItem key={link.label} asChild>
                <a href={link.href} target="_blank" rel="noreferrer">
                  {link.label}
                </a>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <ThemeToggle />
      </div>
    </header>
  )
}
