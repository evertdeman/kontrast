import { describe, expect, test } from 'vitest'
import dicomParser from 'dicom-parser'
import { buildDicom, EXPLICIT_VR_LITTLE_ENDIAN } from '@/test/buildDicom'
import { tagForKeyword } from './header'
import { extractSummary, formatField, SUMMARY_GROUPS } from './summary'

describe('formatField', () => {
  test.each([
    ['20240131', 'date', '2024-01-31'],
    ['2024', 'date', '2024'],
    ['183059', 'time', '18:30:59'],
    ['1830', 'time', '18:30'],
    ['183059.123', 'time', '18:30:59'],
    ['Doe^Jane^^Dr', 'person', 'Doe Jane Dr'],
    ['0.5\\0.5', 'list', '0.5, 0.5'],
    ['F', 'sex', 'Female'],
    ['M', 'sex', 'Male'],
    ['X', 'sex', 'X'],
  ] as const)('%s as %s → %s', (raw, format, expected) => {
    expect(formatField(raw, format)).toBe(expected)
  })

  test('appends a unit', () => {
    expect(formatField('0.5\\0.5', 'list', 'mm')).toBe('0.5, 0.5 mm')
    expect(formatField('80', undefined, 'kg')).toBe('80 kg')
  })
})

describe('extractSummary', () => {
  test('captures only curated keywords that are present', () => {
    const ds = dicomParser.parseDicom(
      buildDicom({
        '00080060': ['CS', 'US'],
        '00100010': ['PN', 'Doe^Jane'],
        '00280010': ['US', [480]],
        '00091010': ['LO', 'private, not curated'],
      }),
    )
    expect(extractSummary(ds)).toEqual({
      Modality: 'US',
      PatientName: 'Doe^Jane',
      Rows: '480',
      // From the file meta header.
      TransferSyntaxUID: EXPLICIT_VR_LITTLE_ENDIAN,
    })
  })

  test('curated keywords are unique, known DICOM keywords', () => {
    const keywords = SUMMARY_GROUPS.flatMap((g) => g.fields.map((f) => f.keyword))
    expect(new Set(keywords).size).toBe(keywords.length)
    expect(keywords.filter((k) => !tagForKeyword(k))).toEqual([])
  })
})
