import { describe, expect, test } from 'vitest'
import dcmjs, { type DicomDataset } from 'dcmjs'
import dicomParser from 'dicom-parser'
import { buildDicom, type DicomDataset as TestDataset } from '@/test/buildDicom'
import {
  PROFILE_KEYWORDS,
  createAnonymizer,
  keywordToTag,
  mayHaveBurnedInText,
  randomUid,
} from './anonymize'

const STUDY_UID = '1.2.826.0.1.1'
const SERIES_UID = '1.2.826.0.1.2'
const FRAME_OF_REFERENCE_UID = '1.2.826.0.1.3'
const CT_IMAGE_STORAGE = '1.2.840.10008.5.1.4.1.1.2'

function image(sopInstanceUid: string, extra: TestDataset = {}): TestDataset {
  return {
    '00080016': ['UI', CT_IMAGE_STORAGE],
    '00080018': ['UI', sopInstanceUid],
    '00080020': ['DA', '20240131'],
    '00080030': ['TM', '093000'],
    '00080050': ['SH', 'ACC42'],
    '00080060': ['CS', 'CT'],
    '00080070': ['LO', 'Acme'],
    '00080080': ['LO', 'St Elsewhere Hospital'],
    '00080081': ['ST', '1 Hospital Road'],
    '00080090': ['PN', 'Who^Doctor'],
    '00081030': ['LO', 'CT head for Jane Doe'],
    '00081140': [
      'SQ',
      [{ '00081150': ['UI', CT_IMAGE_STORAGE], '00081155': ['UI', '1.2.826.0.1.100'] }],
    ],
    '00100010': ['PN', 'Doe^Jane'],
    '00100020': ['LO', 'PID-1'],
    '00100030': ['DA', '19800101'],
    '00100040': ['CS', 'F'],
    '00101010': ['AS', '044Y'],
    '00104000': ['LT', 'Allergic to penicillin'],
    '00180050': ['DS', '1.25'],
    '0020000D': ['UI', STUDY_UID],
    '0020000E': ['UI', SERIES_UID],
    '00200010': ['SH', 'S1'],
    '00200052': ['UI', FRAME_OF_REFERENCE_UID],
    '00280010': ['US', [2]],
    '00280011': ['US', [2]],
    '00291010': ['LO', 'Private vendor data'],
    '60003000': ['OW', new Uint8Array(4)],
    '7FE00010': ['OW', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])],
    ...extra,
  }
}

const toBuffer = (bytes: Uint8Array) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

function anonymizeAll(datasets: TestDataset[]) {
  const anonymizer = createAnonymizer()
  return datasets.map((ds) => {
    const bytes = anonymizer.anonymize(toBuffer(buildDicom(ds)))
    return {
      ...dcmjs.data.DicomMessage.readFile(bytes),
      parsed: dicomParser.parseDicom(new Uint8Array(bytes)),
    }
  })
}

const value = (ds: DicomDataset, tag: string) => ds[tag]?.Value?.[0]

describe('createAnonymizer', () => {
  const [{ meta, dict, parsed }] = anonymizeAll([image('1.2.826.0.1.10')])

  test('replaces the patient name and ID with the same pseudonym', () => {
    const id = value(dict, '00100020')
    expect(id).toMatch(/^ANON-[0-9A-F]{8}$/)
    expect(value(dict, '00100010')).toEqual({ Alphabetic: id })
  })

  test('removes identifying attributes, free text, private tags and overlays', () => {
    for (const tag of ['00080080', '00080081', '00081030', '00101010', '00104000', '00291010', '60003000']) {
      expect(dict, tag).not.toHaveProperty(tag)
    }
  })

  test('keeps dates, times, names and type 2 attributes, but empties them', () => {
    for (const tag of ['00080020', '00080030', '00080050', '00080090', '00100030', '00100040', '00200010']) {
      expect(parsed.elements[`x${tag.toLowerCase()}`]?.length, tag).toBe(0)
    }
  })

  test('keeps attributes needed to show the image', () => {
    expect(value(dict, '00080060')).toBe('CT')
    expect(value(dict, '00080070')).toBe('Acme')
    expect(value(dict, '00180050')).toBe(1.25)
    expect(value(dict, '00280010')).toBe(2)
    expect(new Uint8Array(value(dict, '7FE00010') as ArrayBuffer)).toEqual(
      new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
    )
  })

  test('replaces instance UIDs but keeps SOP class UIDs', () => {
    expect(value(dict, '00080016')).toBe(CT_IMAGE_STORAGE)
    expect(value(dict, '0020000D')).toMatch(/^2\.25\.\d+$/)
    expect(value(dict, '00080018')).not.toBe('1.2.826.0.1.10')
    expect(value(meta, '00020003')).toBe(value(dict, '00080018'))
    const [ref] = dict['00081140'].Value as DicomDataset[]
    expect(value(ref, '00081150')).toBe(CT_IMAGE_STORAGE)
    expect(value(ref, '00081155')).toMatch(/^2\.25\./)
  })

  test('records that the patient identity was removed and how', () => {
    expect(value(dict, keywordToTag('PatientIdentityRemoved')!)).toBe('YES')
    expect(value(dict, keywordToTag('DeidentificationMethod')!)).toBe(
      'Basic Application Confidentiality Profile',
    )
    const [code] = dict[keywordToTag('DeidentificationMethodCodeSequence')!]
      .Value as DicomDataset[]
    expect(value(code, '00080100')).toBe('113100')
  })

  test('maps UIDs and patient IDs consistently across files', () => {
    const [a, b] = anonymizeAll([
      image('1.2.826.0.1.10'),
      image('1.2.826.0.1.11', {
        '00081140': ['SQ', [{ '00081155': ['UI', '1.2.826.0.1.10'] }]],
      }),
    ])
    for (const tag of ['0020000D', '0020000E', '00200052', '00100020']) {
      expect(value(b.dict, tag), tag).toBe(value(a.dict, tag))
    }
    expect(value(b.dict, '00080018')).not.toBe(value(a.dict, '00080018'))
    const [ref] = b.dict['00081140'].Value as DicomDataset[]
    expect(value(ref, '00081155')).toBe(value(a.dict, '00080018'))
  })

  test('gives different patients different pseudonyms', () => {
    const [a, b] = anonymizeAll([
      image('1.2.826.0.1.10'),
      image('1.2.826.0.1.11', { '00100020': ['LO', 'PID-2'] }),
    ])
    expect(value(b.dict, '00100020')).not.toBe(value(a.dict, '00100020'))
  })

  test('starts afresh for each export', () => {
    const [first] = anonymizeAll([image('1.2.826.0.1.10')])
    const [second] = anonymizeAll([image('1.2.826.0.1.10')])
    expect(value(second.dict, '0020000D')).not.toBe(value(first.dict, '0020000D'))
    expect(value(second.dict, '00100020')).not.toBe(value(first.dict, '00100020'))
  })

  test('rejects files that are not DICOM', () => {
    expect(() => createAnonymizer().anonymize(new ArrayBuffer(200))).toThrow()
  })
})

describe('profile', () => {
  test.each([
    ...PROFILE_KEYWORDS.remove,
    ...PROFILE_KEYWORDS.empty,
    ...PROFILE_KEYWORDS.keepUid,
  ])('%s is a known keyword', (keyword) => {
    expect(keywordToTag(keyword)).toMatch(/^[0-9A-F]{8}$/)
  })
})

describe('randomUid', () => {
  test('is a valid UID under the 2.25 root', () => {
    const uid = randomUid()
    expect(uid).toMatch(/^2\.25\.[1-9]\d*$/)
    expect(uid.length).toBeLessThanOrEqual(64)
  })
})

describe('mayHaveBurnedInText', () => {
  const hints = { modality: 'CT', sopClassUID: CT_IMAGE_STORAGE, burnedInAnnotation: '' }

  test.each([
    ['a plain CT image', hints, false],
    ['an ultrasound image', { ...hints, modality: 'US' }, true],
    ['a secondary capture', { ...hints, sopClassUID: '1.2.840.10008.5.1.4.1.1.7' }, true],
    ['an image declaring burned-in text', { ...hints, burnedInAnnotation: 'YES' }, true],
    ['an ultrasound image declaring none', { ...hints, modality: 'US', burnedInAnnotation: 'NO' }, false],
  ])('%s', (_label, input, expected) => {
    expect(mayHaveBurnedInText(input)).toBe(expected)
  })
})
