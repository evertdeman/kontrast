import { beforeEach, describe, expect, test, vi } from 'vitest'
import { cache } from '@cornerstonejs/core'
import { prefetchPart10Instance, wadouri } from '@cornerstonejs/dicom-image-loader'
import { buildDicom, type DicomDataset } from '@/test/buildDicom'
import {
  clearRegisteredFiles,
  getImageFile,
  getImageTags,
  registerFiles,
  releaseImages,
} from './loadDicom'

vi.mock('@cornerstonejs/core', () => ({
  cache: {
    purgeCache: vi.fn(),
    getImageLoadObject: vi.fn(() => undefined),
    removeImageLoadObject: vi.fn(),
  },
}))
vi.mock('@cornerstonejs/dicom-image-loader', () => {
  // Mirrors the real file manager: ids are array indices, and purge() restarts them.
  let files: (File | undefined)[] = []
  return {
    prefetchPart10Instance: vi.fn(async () => {}),
    wadouri: {
      fileManager: {
        add: vi.fn((file: File) => `dicomfile:${files.push(file) - 1}`),
        remove: vi.fn((index: number) => {
          files[index] = undefined
        }),
        purge: vi.fn(() => {
          files = []
        }),
      },
      dataSetCacheManager: {
        purge: vi.fn(),
        isLoaded: vi.fn(() => false),
        unload: vi.fn(),
      },
    },
  }
})

const IMAGE: DicomDataset = {
  '0020000D': ['UI', '1.2.3.1'],
  '0020000E': ['UI', '1.2.3.2'],
  '00280010': ['US', [2]],
  '00280011': ['US', [2]],
  '7FE00010': ['OW', new Uint8Array(8)],
}

let nextSop = 1

/** A DICOM image file; each gets a fresh SOPInstanceUID unless one is given. */
function dicomFile(name: string, extra: DicomDataset = {}): File {
  const dataset = { '00080018': ['UI', `1.2.3.100.${nextSop++}`], ...IMAGE, ...extra } as DicomDataset
  return new File([buildDicom(dataset) as Uint8Array<ArrayBuffer>], name)
}

beforeEach(() => {
  clearRegisteredFiles()
  vi.clearAllMocks()
})

describe('registerFiles', () => {
  test('registers DICOM images and makes their tags and files available', async () => {
    const file = dicomFile('IM0001.dcm')
    const { instances } = await registerFiles([file])
    expect(instances).toHaveLength(1)
    const [imageId] = instances[0].imageIds
    expect(getImageTags(imageId)?.studyUID).toBe('1.2.3.1')
    expect(getImageFile(imageId)).toBe(file)
    expect(prefetchPart10Instance).toHaveBeenCalledOnce()
  })

  test('registers one imageId per frame', async () => {
    const { instances } = await registerFiles([
      dicomFile('multi.dcm', { '00280008': ['IS', '3'] }),
    ])
    expect(instances[0].imageIds).toHaveLength(3)
    for (const id of instances[0].imageIds) expect(getImageTags(id)).toBeDefined()
  })

  test('ignores DICOMDIR and counts skipped files by reason', async () => {
    const progress = vi.fn()
    const { instances, skipped } = await registerFiles(
      [
        dicomFile('IM0001'),
        dicomFile('DICOMDIR'),
        new File(['hello'], 'notes.txt'),
        new File([buildDicom({ '0020000D': ['UI', '1.2.3.1'] }) as Uint8Array<ArrayBuffer>], 'report.dcm'),
      ],
      progress,
    )
    expect(instances).toHaveLength(1)
    expect(skipped).toMatchObject({ notDicom: 1, noImage: 1 })
    expect(progress).toHaveBeenLastCalledWith(3, 3)
  })

  test('stops registering once aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const { instances } = await registerFiles([dicomFile('a.dcm'), dicomFile('b.dcm')], undefined, controller.signal)
    expect(instances).toEqual([])
    expect(wadouri.fileManager.add).not.toHaveBeenCalled()
  })

  test('does not register a file whose read finishes after the abort', async () => {
    const controller = new AbortController()
    const file = dicomFile('a.dcm')
    const read = file.arrayBuffer.bind(file)
    file.arrayBuffer = async () => {
      controller.abort()
      return read()
    }
    const { instances } = await registerFiles([file], undefined, controller.signal)
    expect(instances).toEqual([])
    expect(wadouri.fileManager.add).not.toHaveBeenCalled()
  })
})

describe('duplicates', () => {
  test('skips files that are already registered', async () => {
    const file = dicomFile('IM0001.dcm')
    await registerFiles([file])
    const again = await registerFiles([file, dicomFile('IM0002.dcm')])
    expect(again.instances).toHaveLength(1)
    expect(again.skipped.duplicate).toBe(1)
  })

  test('skips copies within one selection', async () => {
    const file = dicomFile('IM0001.dcm')
    const { instances, skipped } = await registerFiles([file, file])
    expect(instances).toHaveLength(1)
    expect(skipped.duplicate).toBe(1)
  })

  test('registers files again once they were released or cleared', async () => {
    const file = dicomFile('IM0001.dcm')
    const first = await registerFiles([file])
    releaseImages(first.instances[0].imageIds)
    expect((await registerFiles([file])).instances).toHaveLength(1)
    clearRegisteredFiles()
    expect((await registerFiles([file])).instances).toHaveLength(1)
  })
})

describe('releaseImages', () => {
  test('forgets the images and releases their files and cached pixels', async () => {
    const { instances } = await registerFiles([
      dicomFile('multi.dcm', { '00280008': ['IS', '2'] }),
      dicomFile('keep.dcm'),
    ])
    const [released, kept] = instances
    vi.mocked(cache.getImageLoadObject).mockImplementation(
      (id) => (id === released.imageIds[0] ? ({} as never) : undefined),
    )

    releaseImages(released.imageIds)

    for (const id of released.imageIds) expect(getImageTags(id)).toBeUndefined()
    expect(getImageTags(kept.imageIds[0])).toBeDefined()
    expect(wadouri.fileManager.remove).toHaveBeenCalledOnce()
    expect(cache.removeImageLoadObject).toHaveBeenCalledWith(released.imageIds[0], { force: true })
  })
})

describe('clearRegisteredFiles', () => {
  test('never reuses imageIds from an earlier session', async () => {
    const first = await registerFiles([dicomFile('IM0001.dcm')])
    clearRegisteredFiles()
    const second = await registerFiles([dicomFile('IM0001.dcm')])
    expect(second.instances[0].imageIds[0]).not.toBe(first.instances[0].imageIds[0])
  })

  test('forgets registered images and purges Cornerstone caches', async () => {
    const { instances } = await registerFiles([dicomFile('IM0001.dcm')])
    const [imageId] = instances[0].imageIds
    clearRegisteredFiles()
    expect(getImageTags(imageId)).toBeUndefined()
    expect(getImageFile(imageId)).toBeUndefined()
    expect(wadouri.fileManager.remove).toHaveBeenCalledWith(Number(imageId.split(':')[1]))
    expect(wadouri.dataSetCacheManager.purge).toHaveBeenCalled()
    expect(cache.purgeCache).toHaveBeenCalled()
  })
})
