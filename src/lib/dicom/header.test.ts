import { describe, expect, test } from 'vitest'
import dicomParser from 'dicom-parser'
import { buildDicom, type DicomDataset } from '@/test/buildDicom'
import { datasetToRows, formatTag, readHeaderRows, tagForKeyword, valueForKeyword } from './header'

const DATASET: DicomDataset = {
  '00080060': ['CS', 'CT'],
  '00100010': ['PN', 'Doe^John'],
  '00280010': ['US', [512]],
  '00280030': ['DS', '0.5\\0.5'],
  '00181310': ['US', [0, 256, 256, 0]],
  '00081140': ['SQ', [{ '00081150': ['UI', '1.2.3'] }, { '00081150': ['UI', '1.2.4'] }]],
  '00090010': ['LO', 'ACME'],
  '00091010': ['LO', 'ACME private'],
  '7FE00010': ['OW', new Uint8Array(16)],
}

const parse = (dataset: DicomDataset = DATASET) => dicomParser.parseDicom(buildDicom(dataset))
const rowsByTag = () => Object.fromEntries(datasetToRows(parse()).map((r) => [r.id, r]))

describe('formatTag', () => {
  test('formats parser tags as (GGGG,EEEE)', () => {
    expect(formatTag('x0020000e')).toBe('(0020,000E)')
  })
})

describe('tagForKeyword', () => {
  test('maps keywords to parser tags', () => {
    expect(tagForKeyword('PatientName')).toBe('x00100010')
    expect(tagForKeyword('SeriesInstanceUID')).toBe('x0020000e')
  })

  test('unknown keywords give undefined', () => {
    expect(tagForKeyword('NotARealKeyword')).toBeUndefined()
  })
})

describe('datasetToRows', () => {
  test('names and formats standard elements', () => {
    const rows = rowsByTag()
    expect(rows.x00100010).toMatchObject({ tag: '(0010,0010)', vr: 'PN', name: 'PatientName', value: 'Doe^John' })
    expect(rows.x00280010).toMatchObject({ vr: 'US', name: 'Rows', value: '512' })
    expect(rows.x00181310.value).toBe('0\\256\\256\\0')
  })

  test('summarises pixel data instead of dumping it', () => {
    expect(rowsByTag().x7fe00010.value).toBe('<pixel data, 16 bytes>')
  })

  test('labels private creators and private elements', () => {
    const rows = rowsByTag()
    expect(rows.x00090010).toMatchObject({ name: 'PrivateCreator', value: 'ACME' })
    expect(rows.x00091010).toMatchObject({ name: 'Private', value: 'ACME private' })
  })

  test('expands sequences into items and nested elements', () => {
    const rows = datasetToRows(parse())
    const start = rows.findIndex((r) => r.id === 'x00081140')
    expect(rows.slice(start, start + 5).map((r) => [r.kind, r.depth, r.value])).toEqual([
      ['sequence', 0, '2 items'],
      ['item', 1, ''],
      ['element', 2, '1.2.3'],
      ['item', 1, ''],
      ['element', 2, '1.2.4'],
    ])
  })

  test('elements are sorted by tag', () => {
    const tags = datasetToRows(parse()).filter((r) => r.depth === 0).map((r) => r.tag)
    expect(tags).toEqual([...tags].sort())
  })
})

describe('readHeaderRows', () => {
  test('reads rows from a File', async () => {
    const file = new File([buildDicom(DATASET) as Uint8Array<ArrayBuffer>], 'IM0001')
    const rows = await readHeaderRows(file)
    expect(rows.find((r) => r.name === 'Modality')?.value).toBe('CT')
  })
})

describe('valueForKeyword', () => {
  test('returns the formatted value of a top-level element', () => {
    const ds = parse()
    expect(valueForKeyword(ds, 'Modality')).toBe('CT')
    expect(valueForKeyword(ds, 'PixelSpacing')).toBe('0.5\\0.5')
  })

  test('missing elements and sequences give an empty string', () => {
    const ds = parse()
    expect(valueForKeyword(ds, 'StudyDescription')).toBe('')
    expect(valueForKeyword(ds, 'ReferencedImageSequence')).toBe('')
  })
})
