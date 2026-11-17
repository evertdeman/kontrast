import { lazy, Suspense, useEffect, useState } from 'react'
import { Landing } from '@/components/Landing'
import type { WorkspaceEntry } from '@/components/Workspace'

// The viewer pulls in Cornerstone, dcmjs and the DICOM codecs — by far the
// heaviest part of the bundle. Keep it out of the initial download so the
// landing screen paints immediately; it's fetched the moment the user opens
// files or the sample study.
const importWorkspace = () => import('@/components/Workspace')
const Workspace = lazy(importWorkspace)

export default function App() {
  const [entry, setEntry] = useState<WorkspaceEntry | null>(null)

  // Warm the viewer chunk in the background once the landing screen is idle, so
  // opening a study feels instant without weighing down first paint. Safe to
  // call repeatedly — the module cache dedupes it with React.lazy's import.
  useEffect(() => {
    if (entry) return
    const prefetch = () => void importWorkspace()
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(prefetch)
      return () => window.cancelIdleCallback?.(id)
    }
    const timer = window.setTimeout(prefetch, 1500)
    return () => window.clearTimeout(timer)
  }, [entry])

  if (entry) {
    return (
      // While the Workspace chunk downloads, keep the landing screen on-screen
      // in its loading state so the layout stays put.
      <Suspense fallback={<Landing onFiles={() => {}} onSample={() => {}} loading />}>
        <Workspace entry={entry} onExit={() => setEntry(null)} />
      </Suspense>
    )
  }

  return (
    <Landing
      onFiles={(files) => {
        if (files.length > 0) setEntry({ kind: 'files', files })
      }}
      onSample={() => setEntry({ kind: 'sample' })}
    />
  )
}
