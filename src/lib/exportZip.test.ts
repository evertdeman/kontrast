import { beforeEach, describe, expect, test, vi } from 'vitest'
import { unzipSync } from 'fflate'
import dicomParser from 'dicom-parser'
import { buildDicom } from '@/test/buildDicom'
import { resolveTag } from '@/lib/dicom/editTags'
import {
  anonymizeFiles,
  copyKindOf,
  editFiles,
  namedEntries,
  writeAnonymizedZip,
  writeEditedZip,
  writeFilesZip,
  type ZipSink,
} from './exportZip'

function dicomFile(name: string, sopInstanceUid: string): File {
  const bytes = buildDicom({
    '00080018': ['UI', sopInstanceUid],
    '00100010': ['PN', 'Doe^Jane'],
    '0020000D': ['UI', '1.2.826.0.1.1'],
    '7FE00010': ['OW', new Uint8Array(8)],
  })
  return new File([bytes as Uint8Array<ArrayBuffer>], name)
}

function memorySink() {
  const chunks: Uint8Array[] = []
  const sink = {
    write: vi.fn(async (chunk: Uint8Array) => {
      chunks.push(chunk)
    }),
    close: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
  } satisfies ZipSink
  const entries = () => {
    const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
    let offset = 0
    for (const chunk of chunks) {
      out.set(chunk, offset)
      offset += chunk.length
    }
    return unzipSync(out)
  }
  return { sink, entries }
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('namedEntries', () => {
  test('keeps file names, in one numbered folder per series, and avoids clashes', () => {
    const f = (name: string) => new File([], name)
    const entries = namedEntries([
      { seriesUID: 'a', description: 'Axial T1/post', files: [f('IM0001.dcm'), f('IM0001.dcm'), f('IM0002')] },
      { seriesUID: 'b', description: '', files: [f('IM0001')] },
    ])
    expect(entries.map((e) => [e.path, e.seriesUID])).toEqual([
      ['01 Axial T1_post/IM0001.dcm', 'a'],
      ['01 Axial T1_post/IM0001-2.dcm', 'a'],
      ['01 Axial T1_post/IM0002', 'a'],
      ['02 Series/IM0001', 'b'],
    ])
  })
})

describe('writeEditedZip', () => {
  test('writes the edited files under their own names', async () => {
    const { sink, entries } = memorySink()
    const tag = resolveTag('PatientName')!
    const result = await writeEditedZip(
      [{ seriesUID: 's', description: 'Axial', files: [dicomFile('IM0001.dcm', '1.2.826.0.1.10')] }],
      [{ tag, action: 'set', value: 'Test^Patient', seriesUID: null }],
      { newUids: false },
      sink,
    )
    expect(result).toEqual({ written: 1, failed: 0 })
    const ds = dicomParser.parseDicom(entries()['01 Axial/IM0001.dcm'])
    expect(ds.string('x00100010')).toBe('Test^Patient')
    expect(ds.string('x00080018')).toBe('1.2.826.0.1.10')
  })
})

describe('copies opened in Kontrast', () => {
  test('anonymised and edited copies are remembered as such; originals are not', async () => {
    const original = dicomFile('IM0001.dcm', '1.2.826.0.1.10')
    const anonymised = await anonymizeFiles([[original]])
    const edited = await editFiles(
      [{ seriesUID: 's', description: 'Axial', files: [original] }],
      [{ tag: resolveTag('PatientName')!, action: 'set', value: 'X', seriesUID: null }],
      { newUids: true },
    )
    expect(anonymised.files).toHaveLength(1)
    expect(dicomParser.parseDicom(new Uint8Array(await anonymised.files[0].arrayBuffer())).string('x00100010')).toMatch(/^ANON-/)
    expect(copyKindOf(anonymised.files[0])).toBe('anonymised')
    expect(copyKindOf(edited.files[0])).toBe('edited')
    expect(edited.files[0].name).toBe('IM0001.dcm')
    expect(copyKindOf(original)).toBeUndefined()
  })

  test('can be saved as a zip again, unchanged', async () => {
    const { sink, entries } = memorySink()
    const file = dicomFile('0001.dcm', '1.2.826.0.1.10')
    await writeFilesZip([{ seriesUID: 's', description: 'Axial', files: [file] }], sink)
    expect(entries()['01 Axial/0001.dcm']).toEqual(new Uint8Array(await file.arrayBuffer()))
  })
})

describe('writeAnonymizedZip', () => {
  test('writes anonymised files named by position, never by the original name', async () => {
    const { sink, entries } = memorySink()
    const progress = vi.fn()
    const result = await writeAnonymizedZip(
      [
        [dicomFile('Doe_Jane_1.dcm', '1.2.826.0.1.10'), dicomFile('Doe_Jane_2.dcm', '1.2.826.0.1.11')],
        [dicomFile('Doe_Jane_3.dcm', '1.2.826.0.1.12')],
      ],
      sink,
      { onProgress: progress },
    )

    expect(result).toEqual({ written: 3, failed: 0 })
    expect(sink.close).toHaveBeenCalledOnce()
    expect(progress).toHaveBeenLastCalledWith(3, 3)

    const files = entries()
    expect(Object.keys(files).sort()).toEqual([
      'series-01/0001.dcm',
      'series-01/0002.dcm',
      'series-02/0001.dcm',
    ])
    const ds = dicomParser.parseDicom(files['series-01/0001.dcm'])
    expect(ds.string('x00100010')).toMatch(/^ANON-/)
    // One anonymiser for the whole zip keeps the study together.
    const other = dicomParser.parseDicom(files['series-02/0001.dcm'])
    expect(other.string('x0020000d')).toBe(ds.string('x0020000d'))
  })

  test('leaves out files that cannot be anonymised', async () => {
    const { sink, entries } = memorySink()
    const result = await writeAnonymizedZip(
      [[new File(['not dicom'], 'notes.txt'), dicomFile('a.dcm', '1.2.826.0.1.10')]],
      sink,
    )
    expect(result).toEqual({ written: 1, failed: 1 })
    expect(Object.keys(entries())).toEqual(['series-01/0002.dcm'])
  })

  test('fails, and discards the output, when no file can be anonymised', async () => {
    const { sink } = memorySink()
    await expect(writeAnonymizedZip([[new File(['x'], 'x.txt')]], sink)).rejects.toThrow(
      'None of the files',
    )
    expect(sink.abort).toHaveBeenCalledOnce()
    expect(sink.close).not.toHaveBeenCalled()
  })

  test('refuses more files than a zip can hold', async () => {
    const { sink } = memorySink()
    const files = Array.from({ length: 0x10000 }, () => new File([], 'x.dcm'))
    await expect(writeAnonymizedZip([files], sink)).rejects.toThrow('at most')
    expect(sink.write).not.toHaveBeenCalled()
  })

  test('applies the anonymisation options', async () => {
    const { sink, entries } = memorySink()
    const file = new File(
      [buildDicom({ '00080020': ['DA', '20240131'], '7FE00010': ['OW', new Uint8Array(8)] }) as Uint8Array<ArrayBuffer>],
      'a.dcm',
    )
    await writeAnonymizedZip([[file]], sink, { options: { dates: 'keep' } })
    const ds = dicomParser.parseDicom(entries()['series-01/0001.dcm'])
    expect(ds.string('x00080020')).toBe('20240131')
  })

  test('reports the original error even if discarding the output fails', async () => {
    const { sink } = memorySink()
    sink.abort.mockRejectedValueOnce(new Error('disk gone'))
    await expect(writeAnonymizedZip([[new File(['x'], 'x.txt')]], sink)).rejects.toThrow(
      'None of the files',
    )
  })

  test('stops and discards the output when aborted', async () => {
    const { sink } = memorySink()
    const controller = new AbortController()
    const files = [dicomFile('a.dcm', '1.2.826.0.1.10'), dicomFile('b.dcm', '1.2.826.0.1.11')]
    const result = writeAnonymizedZip([files], sink, {
      signal: controller.signal,
      onProgress: () => controller.abort(),
    })
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(sink.abort).toHaveBeenCalledOnce()
    expect(sink.close).not.toHaveBeenCalled()
  })
})
