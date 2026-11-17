import { ScanSearch } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FOOTER_LINKS } from '@/lib/site'

interface SiteFooterProps {
  /** Open links in a new tab so a loaded session isn't lost. */
  newTab?: boolean
  className?: string
}

export function SiteFooter({ newTab, className }: SiteFooterProps) {
  const target = newTab ? { target: '_blank', rel: 'noreferrer' } : {}
  return (
    <footer className={cn('border-t border-line', className)}>
      <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-5 text-[13px] text-muted-foreground sm:px-6 lg:px-10">
        <span className="flex items-center gap-2">
          <ScanSearch className="size-4 flex-none" />
          Not a medical device. Not for diagnostic use.
        </span>
        <nav aria-label="Project" className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {FOOTER_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              {...target}
              className="transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
          <span className="font-mono">v0.1</span>
        </nav>
      </div>
    </footer>
  )
}
