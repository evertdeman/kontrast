import { beforeEach, describe, expect, test, vi } from 'vitest'
import { cache } from '@cornerstonejs/core'
import { prefetchPart10Instance, wadouri } from '@cornerstonejs/dicom-image-loader'
import { buildDicom, type DicomDataset } from '@/test/buildDicom'
import {
  clearRegisteredFiles,
  getImageFile,
  getImageTags,
  registerFiles,
} from './loadDicom'

vi.mock('@cornerstonejs/core', () => ({ cache: { purgeCache: vi.fn() } }))
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
      dataSetCacheManager: { purge: vi.fn() },
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

function dicomFile(name: string, extra: DicomDataset = {}): File {
  return new File([buildDicom({ ...IMAGE, ...extra }) as Uint8Array<ArrayBuffer>], name)
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
