import { useEffect, useRef, useState } from 'react'
import { Layers } from 'lucide-react'
import { utilities } from '@cornerstonejs/core'
import { initCornerstone } from '@/lib/cornerstone/init'
import { cn } from '@/lib/utils'

/**
 * A series' middle image, rendered once the thumbnail scrolls into view.
 * Falls back to a generic icon while loading or if the image cannot be shown.
 */
export function SeriesThumbnail({ imageIds, className }: { imageIds: string[]; className?: string }) {
  const container = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [state, setState] = useState<'idle' | 'ready' | 'failed'>('idle')
  const imageId = imageIds[Math.floor(imageIds.length / 2)]

  useEffect(() => {
    const el = container.current
    if (!el || !imageId) return
    let cancelled = false
    setState('idle')

    const observer = new IntersectionObserver(async ([entry]) => {
      if (!entry.isIntersecting) return
      observer.disconnect()
      try {
        await initCornerstone()
        if (cancelled || !canvas.current) return
        await utilities.loadImageToCanvas({ canvas: canvas.current, imageId, thumbnail: true })
        if (!cancelled) setState('ready')
      } catch {
        if (!cancelled) setState('failed')
      }
    })
    observer.observe(el)
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [imageId])

  return (
    <div
      ref={container}
      className={cn(
        'relative flex flex-none items-center justify-center overflow-hidden rounded-md border border-line bg-black',
        state !== 'ready' && 'bg-gradient-to-br from-zinc-700 to-black',
        className,
      )}
    >
      {/* loadImageToCanvas sets an inline pixel size; the class overrides it to fill the box. */}
      <canvas
        ref={canvas}
        aria-hidden
        className={cn('!size-full object-contain', state !== 'ready' && 'invisible')}
      />
      {state !== 'ready' && <Layers className="absolute size-4 text-zinc-500" />}
    </div>
  )
}
