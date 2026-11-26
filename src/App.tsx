import { lazy, Suspense, useEffect, useState } from 'react'
import { Landing } from '@/components/Landing'
import { Privacy } from '@/components/Privacy'
import { Imprint } from '@/components/Imprint'
import { IMPRINT_HASH, PRIVACY_HASH } from '@/lib/site'
import type { WorkspaceEntry } from '@/components/Workspace'

// The viewer pulls in Cornerstone, dcmjs and the DICOM codecs — by far the
// heaviest part of the bundle. Keep it out of the initial download so the
// landing screen paints immediately; it's fetched the moment the user opens
// files or the sample study.
const importWorkspace = () => import('@/components/Workspace')
const Workspace = lazy(importWorkspace)

/** The current URL hash, kept in sync with navigation. */
function useHash(): string {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const update = () => setHash(window.location.hash)
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  return hash
}

export default function App() {
  const [entry, setEntry] = useState<WorkspaceEntry | null>(null)
  const hash = useHash()

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

  // An open session always wins, so a stray hash change can't throw it away;
  // links to these pages open in a new tab from there.
  if (!entry) {
    if (hash === PRIVACY_HASH) return <Privacy />
    if (hash === IMPRINT_HASH) return <Imprint />
  }

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
