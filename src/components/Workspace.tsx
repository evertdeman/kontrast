import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Studies } from '@/components/Studies'
import { Viewer } from '@/components/Viewer'
import {
  registerFiles,
  clearRegisteredFiles,
  describeSkipped,
  type IndexingProgress,
  type RegisteredInstance,
} from '@/lib/cornerstone/loadDicom'
import { groupIntoStudies, type StudyInfo } from '@/lib/cornerstone/studies'
import { expandArchives, loadSampleFiles } from '@/lib/files'

/**
 * How the workspace was entered. App mounts Workspace lazily with one of these,
 * so Cornerstone (and this whole chunk) is only fetched once the user commits to
 * opening something.
 */
export type WorkspaceEntry = { kind: 'files'; files: File[] } | { kind: 'sample' }

interface WorkspaceProps {
  entry: WorkspaceEntry
  /** Return to the landing screen, discarding the current session. */
  onExit: () => void
}

type View = 'studies' | 'viewer'

export default function Workspace({ entry, onExit }: WorkspaceProps) {
  const [view, setView] = useState<View>('studies')
  const [registered, setRegistered] = useState<RegisteredInstance[]>([])
  const [studies, setStudies] = useState<StudyInfo[]>([])
  const [active, setActive] = useState<{ studyUID: string; seriesUID: string } | null>(
    null,
  )
  const [indexing, setIndexing] = useState<IndexingProgress | null>(null)
  // Aborted when the session is cleared, so in-flight indexing stops registering files.
  const session = useRef(new AbortController())

  const handleFiles = useCallback(
    async (files: File[], append = false) => {
      const { signal } = session.current
      if (files.length === 0 || signal.aborted) return
      setView('studies')
      setIndexing({ done: 0, total: 0, unpacking: true })
      try {
        const { files: expanded, failedArchives } = await expandArchives(files, {
          onProgress: (done, total) => setIndexing({ done, total, unpacking: true }),
          signal,
        })
        if (signal.aborted) return
        setIndexing({ done: 0, total: expanded.length })
        const { instances, skipped } = await registerFiles(
          expanded,
          (done, total) => setIndexing({ done, total }),
          signal,
        )
        if (signal.aborted) return
        skipped.badArchive += failedArchives
        const skippedNote = describeSkipped(skipped) ?? undefined
        if (instances.length === 0) {
          toast.error('No DICOM images found in that selection.', {
            description: skippedNote,
          })
          // Nothing landed and nothing was open: fall back to the landing screen.
          if (!append && registered.length === 0) onExit()
          return
        }
        const all = append ? [...registered, ...instances] : instances
        setRegistered(all)
        setStudies(groupIntoStudies(all))
        const images = instances.reduce((n, inst) => n + inst.imageIds.length, 0)
        toast.success(`Indexed ${images} image${images === 1 ? '' : 's'}.`, {
          description: skippedNote,
          duration: skippedNote ? 8000 : undefined,
        })
      } catch (err) {
        if (signal.aborted) return
        console.error(err)
        toast.error('Could not read those files as DICOM.')
        if (!append && registered.length === 0) onExit()
      } finally {
        setIndexing(null)
      }
    },
    [registered, onExit],
  )

  const openSample = useCallback(async () => {
    try {
      await handleFiles(await loadSampleFiles())
    } catch (err) {
      console.error(err)
      toast.error('Could not load the sample study.')
      onExit()
    }
  }, [handleFiles, onExit])

  // Process whatever the user chose on the landing screen, exactly once.
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    if (entry.kind === 'sample') void openSample()
    else void handleFiles(entry.files)
    // Intentionally run once on mount; `entry` is fixed for a given mount and
    // the handlers close over state that must not retrigger processing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openSeries = useCallback((studyUID: string, seriesUID: string) => {
    setActive({ studyUID, seriesUID })
    setView('viewer')
  }, [])

  const clearSession = useCallback(() => {
    session.current.abort()
    clearRegisteredFiles()
    onExit()
  }, [onExit])

  const activeStudy = active
    ? studies.find((s) => s.studyUID === active.studyUID)
    : undefined

  if (view === 'viewer' && active && activeStudy) {
    return (
      <Viewer
        study={activeStudy}
        initialSeriesUID={active.seriesUID}
        onBack={() => setView('studies')}
      />
    )
  }

  return (
    <Studies
      studies={studies}
      indexing={indexing}
      onOpenSeries={openSeries}
      onAddFiles={(files) => handleFiles(files, true)}
      onClearSession={clearSession}
    />
  )
}
