import { describe, expect, test } from 'vitest'
import dcmjs, { type DicomDataset } from 'dcmjs'
import dicomParser from 'dicom-parser'
import { buildDicom, type DicomDataset as TestDataset } from '@/test/buildDicom'
import {
  createAnonymizer,
  mayHaveBurnedInText,
  randomUid,
  shiftDate,
  type AnonymizeOptions,
} from './anonymize'
import { BASIC_PROFILE } from './basicProfile'

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
    '0008002A': ['DT', '20240131093000.000000+0100'],
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
    '00081190': ['UR', 'https://pacs.hospital.example/studies/1.2.826.0.1.1'],
    '00100010': ['PN', 'Doe^Jane'],
    '00100020': ['LO', 'PID-1'],
    '00100030': ['DA', '19800101'],
    '00100040': ['CS', 'F'],
    '00101010': ['AS', '044Y'],
    '00101020': ['DS', '1.70'],
    '00101030': ['DS', '65'],
    '00104000': ['LT', 'Allergic to penicillin'],
    '00120040': ['LO', 'TRIAL-SUBJECT-7'],
    '00180050': ['DS', '1.25'],
    '0020000D': ['UI', STUDY_UID],
    '0020000E': ['UI', SERIES_UID],
    '00200010': ['SH', 'S1'],
    '00200032': ['DS', '-100\\-100\\50'],
    '00200052': ['UI', FRAME_OF_REFERENCE_UID],
    '00280010': ['US', [2]],
    '00280011': ['US', [2]],
    '00291010': ['LO', 'Private vendor data'],
    '0040A073': [
      'SQ',
      [{ '0040A027': ['LO', 'Verifying Org'], '0040A075': ['PN', 'Who^Doctor'] }],
    ],
    '0040A370': [
      'SQ',
      [{ '00100020': ['LO', 'PID-1'], '00080050': ['SH', 'ACC42'] }],
    ],
    '60003000': ['OW', new Uint8Array(4)],
    '7FE00010': ['OW', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])],
    ...extra,
  }
}

const toBuffer = (bytes: Uint8Array) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

function anonymizeAll(datasets: TestDataset[], options: Partial<AnonymizeOptions> = {}) {
  const anonymizer = createAnonymizer(options)
  return datasets.map((ds) => {
    const bytes = anonymizer.anonymize(toBuffer(buildDicom(ds)))
    const parsed = dicomParser.parseDicom(new Uint8Array(bytes))
    return {
      ...dcmjs.data.DicomMessage.readFile(bytes),
      parsed,
      /** Whether the element is present with a zero-length value. */
      isEmpty: (tag: string) => parsed.elements[`x${tag.toLowerCase()}`]?.length === 0,
      text: new TextDecoder('latin1').decode(bytes),
    }
  })
}

const anonymizeOne = (options: Partial<AnonymizeOptions> = {}, extra: TestDataset = {}) =>
  anonymizeAll([image('1.2.826.0.1.10', extra)], options)[0]

const value = (ds: DicomDataset, tag: string) => ds[tag]?.Value?.[0]
const items = (ds: DicomDataset, tag: string) => (ds[tag]?.Value ?? []) as DicomDataset[]

describe('createAnonymizer', () => {
  const { meta, dict, isEmpty, text } = anonymizeOne()

  test('replaces the patient name and ID with the same pseudonym', () => {
    const id = value(dict, '00100020')
    expect(id).toMatch(/^ANON-[0-9A-F]{8}$/)
    expect(value(dict, '00100010')).toEqual({ Alphabetic: id })
  })

  test('leaves none of the identifying values anywhere in the file', () => {
    for (const secret of [
      'Doe', 'PID-1', 'ACC42', 'Hospital', 'Jane', 'penicillin', 'TRIAL-SUBJECT',
      'Verifying Org', 'Private vendor', 'pacs.hospital', '1.2.826.0.1.',
      '19800101', '20240131', '044Y',
    ]) {
      expect(text, secret).not.toContain(secret)
    }
  })

  test('removes private tags, overlays, free text and URLs', () => {
    for (const tag of ['00291010', '60003000', '00080081', '00104000', '00081190']) {
      expect(dict, tag).not.toHaveProperty(tag)
    }
  })

  test('applies the profile table: X removes, Z and D empty', () => {
    expect(dict).not.toHaveProperty('00081030') // Study Description: X
    expect(dict).not.toHaveProperty('00101010') // Patient's Age: X
    for (const tag of ['00080050', '00200010', '00100040', '00080090']) {
      expect(isEmpty(tag), tag).toBe(true) // Z
    }
    // Verifying Observer Sequence (D) is kept without items, so nothing nested leaks.
    expect(items(dict, '0040A073')).toEqual([])
  })

  test('cleans nested items too', () => {
    const [item] = items(dict, '0040A370')
    expect(value(item, '00100020') ?? '').toBe('')
  })

  test('removes all dates and times by default', () => {
    for (const tag of ['00080020', '00080030', '0008002A', '00100030']) {
      expect(isEmpty(tag), tag).toBe(true)
    }
    expect(value(dict, '00280303')).toBe('REMOVED')
  })

  test('keeps attributes needed to show the image', () => {
    expect(value(dict, '00080060')).toBe('CT')
    expect(value(dict, '00080070')).toBe('Acme')
    expect(value(dict, '00180050')).toBe(1.25)
    expect(dict['00200032'].Value).toEqual([-100, -100, 50])
    expect(value(dict, '00280010')).toBe(2)
    expect(new Uint8Array(value(dict, '7FE00010') as ArrayBuffer)).toEqual(
      new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
    )
  })

  test('replaces instance UIDs but keeps SOP class UIDs', () => {
    expect(value(dict, '00080016')).toBe(CT_IMAGE_STORAGE)
    expect(value(dict, '0020000D')).toMatch(/^2\.25\.\d+$/)
    expect(value(meta, '00020003')).toBe(value(dict, '00080018'))
    const [ref] = items(dict, '00081140')
    expect(value(ref, '00081150')).toBe(CT_IMAGE_STORAGE)
    expect(value(ref, '00081155')).toMatch(/^2\.25\./)
  })

  test('records that the patient identity was removed and how', () => {
    expect(value(dict, '00120062')).toBe('YES')
    expect(dict['00120063'].Value).toEqual(['Basic Application Confidentiality Profile'])
    expect(items(dict, '00120064').map((code) => value(code, '00080100'))).toEqual(['113100'])
  })

  test('removes public attributes it does not know', () => {
    const { dict } = anonymizeOne({}, { '0018FF10': ['LO', 'Doe'] })
    expect(dict).not.toHaveProperty('0018FF10')
  })

  test('leaves empty UIDs empty', () => {
    const { isEmpty } = anonymizeOne({}, { '00200052': ['UI', ''] })
    expect(isEmpty('00200052')).toBe(true)
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
    const [ref] = items(b.dict, '00081140')
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
    const first = anonymizeOne()
    const second = anonymizeOne()
    expect(value(second.dict, '0020000D')).not.toBe(value(first.dict, '0020000D'))
    expect(value(second.dict, '00100020')).not.toBe(value(first.dict, '00100020'))
  })

  test('rejects files that are not DICOM', () => {
    expect(() => createAnonymizer().anonymize(new ArrayBuffer(200))).toThrow()
  })
})

describe('options', () => {
  test('shifting moves every date by the same number of days and keeps times', () => {
    const { dict } = anonymizeOne({ dates: 'shift', dateOffsetDays: -10 })
    expect(value(dict, '00080020')).toBe('20240121')
    expect(value(dict, '00100030')).toBe('19791222')
    expect(value(dict, '0008002A')).toBe('20240121093000.000000+0100')
    expect(value(dict, '00080030')).toBe('093000')
    expect(value(dict, '00280303')).toBe('MODIFIED')
    expect(items(dict, '00120064').map((code) => value(code, '00080100'))).toEqual([
      '113100',
      '113107',
    ])
  })

  test('shifts by a random number of days when no offset is given', () => {
    const { dict } = anonymizeOne({ dates: 'shift' })
    const studyDate = String(value(dict, '00080020'))
    expect(studyDate).toMatch(/^\d{8}$/)
    expect(studyDate).not.toBe('20240131')
  })

  test('keeping dates keeps them as they are', () => {
    const { dict } = anonymizeOne({ dates: 'keep' })
    expect(value(dict, '00080020')).toBe('20240131')
    expect(value(dict, '00100030')).toBe('19800101')
    expect(value(dict, '00280303')).toBe('UNMODIFIED')
  })

  test('can keep the age, sex, height and weight', () => {
    const { dict } = anonymizeOne({ keepAge: true, keepSex: true, keepSizeAndWeight: true })
    expect(value(dict, '00101010')).toBe('044Y')
    expect(value(dict, '00100040')).toBe('F')
    expect(value(dict, '00101020')).toBe(1.7)
    expect(value(dict, '00101030')).toBe(65)
    expect(items(dict, '00120064').map((code) => value(code, '00080100'))).toEqual([
      '113100',
      '113108',
    ])
  })
})

describe('shiftDate', () => {
  test.each([
    ['20240131', 1, '20240201'],
    ['20240301', -1, '20240229'],
    ['20231231', 1, '20240101'],
    ['20240131', -365, '20230131'],
  ])('%s by %i days is %s', (date, days, expected) => {
    expect(shiftDate(date, days)).toBe(expected)
  })

  test.each(['2024', '2024.01.31', '20240231', ''])('rejects %j', (date) => {
    expect(shiftDate(date, 1)).toBeNull()
  })
})

describe('profile table', () => {
  test('never removes attributes needed to show an image', () => {
    for (const tag of ['00080016', '00080060', '00200032', '00200037', '00280010', '00280011', '00280100', '7FE00010']) {
      expect(BASIC_PROFILE.has(tag), tag).toBe(false)
    }
  })

  test('covers the attributes that identify a patient', () => {
    expect(BASIC_PROFILE.get('00100010')).toBe('Z')
    expect(BASIC_PROFILE.get('00100030')).toBe('Z')
    expect(BASIC_PROFILE.get('00081030')).toBe('X')
    expect(BASIC_PROFILE.get('00080018')).toBe('U')
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
