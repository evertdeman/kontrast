import { describe, expect, test } from 'vitest'
import type { DicomTags } from '@/lib/dicom/parse'
import type { SeriesInfo, StudyInfo } from '@/lib/cornerstone/studies'
import {
  ageInYears,
  formatDuration,
  formatRange,
  getStudyDetails,
  parseTime,
} from './studyDetails'

function tags(overrides: Partial<DicomTags> = {}, summary: Record<string, string> = {}): DicomTags {
  return {
    studyUID: '1.2.3',
    seriesUID: 'axial',
    sopUID: '',
    sopClassUID: '',
    modality: 'CT',
    studyDescription: 'Head',
    seriesDescription: 'Axial',
    studyDate: '20240131',
    patientName: 'Doe Jane',
    patientId: 'PID-1',
    patientSex: 'F',
    seriesNumber: 1,
    instanceNumber: null,
    rows: 512,
    columns: 512,
    numberOfFrames: 1,
    imageOrientation: [1, 0, 0, 0, 1, 0],
    imagePosition: null,
    patientOrientation: null,
    accession: 'ACC1',
    burnedInAnnotation: '',
    summary: {
      PatientName: 'Doe^Jane',
      PatientID: 'PID-1',
      PatientBirthDate: '19800615',
      PatientSex: 'F',
      StudyDate: '20240131',
      StudyInstanceUID: '1.2.3',
      InstitutionName: 'St Elsewhere',
      ...summary,
    },
    ...overrides,
  }
}

function series(uid: string, imageIds: string[], extra: Partial<SeriesInfo> = {}): SeriesInfo {
  return {
    seriesUID: uid,
    seriesNumber: 1,
    description: uid,
    modality: 'CT',
    imageIds,
    bytes: 1000,
    ...extra,
  }
}

function study(list: SeriesInfo[]): StudyInfo {
  return {
    studyUID: '1.2.3',
    description: 'Head',
    patient: 'Doe Jane',
    date: '2024-01-31',
    modality: 'CT',
    accession: 'ACC1',
    series: list,
    imageCount: 0,
    bytes: 0,
  }
}

describe('getStudyDetails', () => {
  const registry = new Map<string, DicomTags>([
    ['a1', tags({ imagePosition: [0, 0, 0] }, { AcquisitionTime: '120000' })],
    ['a2', tags({ imagePosition: [0, 0, 120] }, { AcquisitionTime: '120030.5' })],
    ['a3', tags({ imagePosition: [0, 0, 240] }, { AcquisitionTime: '120214' })],
    ['s1', tags({ modality: 'SR', imageOrientation: null })],
  ])
  const details = getStudyDetails(
    study([
      series('axial', ['a1', 'a2', 'a3']),
      series('report', ['s1'], { modality: 'SR', seriesNumber: 99 }),
    ]),
    (id) => registry.get(id),
  )

  test('lists patient details and works out the age at the study', () => {
    expect(details.patient).toEqual([
      { label: 'Name', value: 'Doe Jane' },
      { label: 'ID', value: 'PID-1' },
      { label: 'Birth date', value: '1980-06-15' },
      { label: 'Sex', value: 'Female' },
      { label: 'Age', value: '43 years' },
    ])
  })

  test('lists study details, with a copy button for the UID', () => {
    expect(details.study).toContainEqual({ label: 'Institution', value: 'St Elsewhere' })
    expect(details.study).toContainEqual({ label: 'Study UID', value: '1.2.3', copy: true })
  })

  test('lists every modality and patient ID in the study', () => {
    expect(details.modalities).toEqual(['CT', 'SR'])
    expect(details.patientIds).toEqual(['PID-1'])
  })

  test('works out the scan range and acquisition time of each series', () => {
    const [axial, report] = details.series
    expect(axial).toMatchObject({ images: 3, rangeMm: 240, durationSeconds: 134 })
    expect(report).toMatchObject({ images: 1, rangeMm: null, durationSeconds: null })
  })

  test('notices files from different patients in one study', () => {
    const other = new Map([...registry, ['b1', tags({ patientId: 'PID-2' })]])
    const mixed = getStudyDetails(study([series('axial', ['a1', 'b1'])]), (id) => other.get(id))
    expect(mixed.patientIds).toEqual(['PID-1', 'PID-2'])
  })

  test('keeps a stated age instead of working one out', () => {
    const stated = new Map([['x', tags({}, { PatientAge: '044Y' })]])
    const { patient } = getStudyDetails(study([series('s', ['x'])]), (id) => stated.get(id))
    expect(patient).toContainEqual({ label: 'Age', value: '44 years' })
  })

  test('says when the age is unknown', () => {
    const none = new Map([['x', tags({}, { PatientBirthDate: '' })]])
    const { patient } = getStudyDetails(study([series('s', ['x'])]), (id) => none.get(id))
    expect(patient).toContainEqual({ label: 'Age', value: 'Unknown' })
  })
})

describe('helpers', () => {
  test.each([
    ['093000', 34200],
    ['0930', 34200],
    ['093000.5', 34200.5],
    ['', null],
  ])('parseTime(%j) is %j', (raw, expected) => {
    expect(parseTime(raw)).toBe(expected)
  })

  test.each([
    ['19800615', '20240614', 43],
    ['19800615', '20240615', 44],
    ['19800615', '1979', null],
  ])('ageInYears(%s, %s) is %j', (birth, on, expected) => {
    expect(ageInYears(birth, on)).toBe(expected)
  })

  test('formats durations and ranges', () => {
    expect(formatDuration(45)).toBe('45 s')
    expect(formatDuration(134)).toBe('2 min 14 s')
    expect(formatDuration(120)).toBe('2 min')
    expect(formatRange(240.4)).toBe('240 mm')
    expect(formatRange(4.25)).toBe('4.3 mm')
  })
})
