import { describe, expect, test } from 'vitest'
import { strToU8, zipSync, type Zippable } from 'fflate'
import { expandArchives } from './files'

function zipFile(name: string, entries: Zippable): File {
  return new File([zipSync(entries) as Uint8Array<ArrayBuffer>], name, { type: 'application/zip' })
}

const names = (files: File[]) => files.map((f) => f.name).sort()

describe('expandArchives', () => {
  test('passes non-archive files through untouched', async () => {
    const dcm = new File([strToU8('x')], 'IM0001.dcm')
    const { files, failedArchives } = await expandArchives([dcm])
    expect(files).toEqual([dcm])
    expect(failedArchives).toBe(0)
  })

  test('extracts files from nested folders using their base names', async () => {
    const zip = zipFile('study.zip', {
      DICOMDIR: strToU8('index'),
      'PATIENT/STUDY/SERIES/IM0001': strToU8('a'),
      'PATIENT/STUDY/SERIES/IM0002': strToU8('b'),
    })
    const { files } = await expandArchives([zip])
    expect(names(files)).toEqual(['DICOMDIR', 'IM0001', 'IM0002'])
    expect(await files.find((f) => f.name === 'IM0002')!.text()).toBe('b')
  })

  test('skips macOS Finder metadata', async () => {
    const zip = zipFile('mac.zip', {
      'scan/IM0001': strToU8('a'),
      'scan/.DS_Store': strToU8('junk'),
      '__MACOSX/scan/._IM0001': strToU8('junk'),
    })
    const { files } = await expandArchives([zip])
    expect(names(files)).toEqual(['IM0001'])
  })

  test('expands a zip inside a zip', async () => {
    const inner = zipSync({ 'IM0002': strToU8('b') })
    const outer = zipFile('outer.zip', { 'IM0001': strToU8('a'), 'inner.zip': inner })
    const { files } = await expandArchives([outer])
    expect(names(files)).toEqual(['IM0001', 'IM0002'])
  })

  test('reports progress as entries are unpacked', async () => {
    const progress: [number, number][] = []
    await expandArchives([zipFile('a.zip', { IM0001: strToU8('a'), IM0002: strToU8('b') })], {
      onProgress: (done, total) => progress.push([done, total]),
    })
    expect(progress.at(-1)).toEqual([2, 2])
  })

  test('stops when aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const zip = zipFile('a.zip', { IM0001: strToU8('a') })
    await expect(expandArchives([zip], { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
  })

  test('keeps the readable entries of a partly damaged archive', async () => {
    const bytes = zipSync({ IM0001: strToU8('a'.repeat(1000)), IM0002: strToU8('b') })
    bytes[40] ^= 0xff // corrupt IM0001's deflated data
    const zip = new File([bytes as Uint8Array<ArrayBuffer>], 'a.zip')
    const { files, failedArchives } = await expandArchives([zip])
    expect(names(files)).toEqual(['IM0002'])
    expect(failedArchives).toBe(1)
  })

  test('counts damaged archives instead of throwing', async () => {
    const broken = new File([strToU8('not really a zip')], 'broken.zip')
    const dcm = new File([strToU8('x')], 'IM0001.dcm')
    const { files, failedArchives } = await expandArchives([broken, dcm])
    expect(names(files)).toEqual(['IM0001.dcm'])
    expect(failedArchives).toBe(1)
  })
})
