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

  test('counts damaged archives instead of throwing', async () => {
    const broken = new File([strToU8('not really a zip')], 'broken.zip')
    const dcm = new File([strToU8('x')], 'IM0001.dcm')
    const { files, failedArchives } = await expandArchives([broken, dcm])
    expect(names(files)).toEqual(['IM0001.dcm'])
    expect(failedArchives).toBe(1)
  })
})
