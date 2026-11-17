import { cn } from '@/lib/utils'

/** The logo mark: white rounded square with the aperture glyph. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-[7px] bg-primary text-primary-foreground',
        className ?? 'size-7',
      )}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="8" />
        <path d="M12 4v16" />
        <path d="M12 8a4 4 0 0 1 0 8" />
      </svg>
    </div>
  )
}
