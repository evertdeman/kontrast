import { describe, expect, test } from 'vitest'
import { buildDicom, type DicomDataset } from '@/test/buildDicom'
import {
  describeSkipped,
  emptySkipCounts,
  frameImageIds,
  looksLikeDicom,
  parseTags,
  SkipError,
  type SkipReason,
} from './parse'

const IMAGE: DicomDataset = {
  '00080018': ['UI', '1.2.3.100'],
  '00080020': ['DA', '20240131'],
  '00080050': ['SH', 'ACC42'],
  '00080060': ['CS', 'MR'],
  '00081030': ['LO', 'Brain'],
  '0008103E': ['LO', 'T1 sagittal'],
  '00100010': ['PN', 'Doe^Jane'],
  '00100020': ['LO', 'PID-1'],
  '00100040': ['CS', 'F'],
  '0020000D': ['UI', '1.2.3.1'],
  '0020000E': ['UI', '1.2.3.2'],
  '00200011': ['IS', '3'],
  '00200013': ['IS', '7'],
  '00280010': ['US', [2]],
  '00280011': ['US', [4]],
  '7FE00010': ['OW', new Uint8Array(16)],
}

function parse(extra: DicomDataset = {}, options?: { transferSyntax?: string }) {
  return parseTags(buildDicom({ ...IMAGE, ...extra }, options))
}

function skipReason(run: () => unknown): SkipReason | undefined {
  try {
    run()
  } catch (err) {
    if (err instanceof SkipError) return err.reason
    throw err
  }
  return undefined
}

describe('parseTags', () => {
  test('reads the tags used for grouping and display', () => {
    expect(parse()).toMatchObject({
      studyUID: '1.2.3.1',
      seriesUID: '1.2.3.2',
      sopUID: '1.2.3.100',
      modality: 'MR',
      studyDescription: 'Brain',
      seriesDescription: 'T1 sagittal',
      studyDate: '20240131',
      patientName: 'Doe Jane',
      patientId: 'PID-1',
      patientSex: 'F',
      seriesNumber: 3,
      instanceNumber: 7,
      rows: 2,
      columns: 4,
      accession: 'ACC42',
    })
  })

  test('missing optional tags become empty values', () => {
    const { '00200013': _instance, '00080060': _modality, ...rest } = IMAGE
    const tags = parseTags(buildDicom(rest))
    expect(tags.instanceNumber).toBeNull()
    expect(tags.modality).toBe('')
  })

  test('captures curated summary values for the inspector', () => {
    expect(parse().summary).toMatchObject({ Modality: 'MR', PatientName: 'Doe^Jane' })
  })

  test.each([
    [undefined, 1],
    ['1', 1],
    ['10', 10],
    ['0', 1],
  ])('NumberOfFrames %s gives %i frame(s)', (frames, expected) => {
    const extra: DicomDataset = frames ? { '00280008': ['IS', frames] } : {}
    expect(parse(extra).numberOfFrames).toBe(expected)
  })

  describe('geometry', () => {
    test('reads top-level orientation and position', () => {
      const tags = parse({
        '00200037': ['DS', '0\\1\\0\\0\\0\\-1'],
        '00200032': ['DS', '-12.5\\-100\\80'],
      })
      expect(tags.imageOrientation).toEqual([0, 1, 0, 0, 0, -1])
      expect(tags.imagePosition).toEqual([-12.5, -100, 80])
    })

    test('ignores malformed orientation', () => {
      expect(parse({ '00200037': ['DS', '1\\0\\0\\0\\1'] }).imageOrientation).toBeNull()
    })

    test('reads enhanced multi-frame functional groups', () => {
      const tags = parse({
        '52009229': ['SQ', [{ '00209116': ['SQ', [{ '00200037': ['DS', '1\\0\\0\\0\\1\\0'] }]] }]],
        '52009230': ['SQ', [{ '00209113': ['SQ', [{ '00200032': ['DS', '1\\2\\3'] }]] }]],
      })
      expect(tags.imageOrientation).toEqual([1, 0, 0, 0, 1, 0])
      expect(tags.imagePosition).toEqual([1, 2, 3])
    })

    test.each([
      ['L\\F', ['L', 'F']],
      ['AL\\F', ['AL', 'F']],
      ['L', null],
      ['', null],
    ])('PatientOrientation %j', (raw, expected) => {
      expect(parse({ '00200020': ['CS', raw] }).patientOrientation).toEqual(expected)
    })
  })

  describe('skipped files', () => {
    test('random bytes are not DICOM', () => {
      expect(skipReason(() => parseTags(new TextEncoder().encode('hello world')))).toBe('notDicom')
    })

    test('a DICOM object without pixel data has no image', () => {
      const { '7FE00010': _pixels, ...report } = IMAGE
      expect(skipReason(() => parseTags(buildDicom(report)))).toBe('noImage')
    })

    test('float pixel data counts as an image', () => {
      const { '7FE00010': _pixels, ...rest } = IMAGE
      const tags = parseTags(buildDicom({ ...rest, '7FE00008': ['OF', new Uint8Array(16)] }))
      expect(tags.modality).toBe('MR')
    })

    test('video transfer syntaxes are unsupported', () => {
      const mpeg4 = '1.2.840.10008.1.2.4.102'
      expect(skipReason(() => parse({}, { transferSyntax: mpeg4 }))).toBe('unsupported')
    })
  })
})

describe('looksLikeDicom', () => {
  const dicomBytes = buildDicom(IMAGE)

  test.each([
    ['IM0001.dcm', 'not dicom'],
    ['IM0001', 'not dicom'],
    ['1.2.840.113619.2.55.3', 'not dicom'],
  ])('%s is read without checking its contents', async (name, body) => {
    expect(await looksLikeDicom(new File([body], name))).toBe(true)
  })

  test('other extensions need the DICM magic', async () => {
    expect(await looksLikeDicom(new File(['plain text'], 'README.txt'))).toBe(false)
    expect(await looksLikeDicom(new File([dicomBytes as Uint8Array<ArrayBuffer>], 'scan.bin'))).toBe(true)
  })
})

describe('frameImageIds', () => {
  test('single-frame files keep their imageId', () => {
    expect(frameImageIds('dicomfile:0', 1)).toEqual(['dicomfile:0'])
  })

  test('multi-frame files get one 1-based imageId per frame', () => {
    expect(frameImageIds('dicomfile:3', 3)).toEqual([
      'dicomfile:3?frame=1',
      'dicomfile:3?frame=2',
      'dicomfile:3?frame=3',
    ])
  })
})

describe('describeSkipped', () => {
  test('nothing skipped gives no message', () => {
    expect(describeSkipped(emptySkipCounts())).toBeNull()
  })

  test('uses singular and plural forms', () => {
    expect(describeSkipped({ ...emptySkipCounts(), noImage: 1 })).toBe(
      'Skipped 1 file: 1 has no image (report, PDF or other non-image object).',
    )
    expect(describeSkipped({ ...emptySkipCounts(), notDicom: 3 })).toBe(
      'Skipped 3 files: 3 not DICOM.',
    )
  })

  test('lists every reason with a total', () => {
    const message = describeSkipped({
      notDicom: 2,
      noImage: 0,
      unsupported: 1,
      badArchive: 1,
      duplicate: 2,
    })
    expect(message).toBe(
      'Skipped 6 files: 2 not DICOM; 1 uses an unsupported compression (e.g. video); ' +
        '1 is a zip that could not be opened (damaged or encrypted); 2 were already open.',
    )
  })
})
