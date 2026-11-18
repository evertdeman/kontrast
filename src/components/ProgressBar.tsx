/** A thin determinate progress bar; `value` is a percentage. */
export function ProgressBar({ value, label }: { value: number; label?: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-1.5 overflow-hidden rounded-full bg-line-strong"
    >
      <div
        className="h-full rounded-full bg-primary transition-[width]"
        style={{ width: `${value}%` }}
      />
    </div>
  )
}
