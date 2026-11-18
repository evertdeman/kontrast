import { describe, expect, test } from 'vitest'
import type { RegisteredInstance } from '@/lib/cornerstone/loadDicom'
import type { DicomTags } from '@/lib/dicom/parse'
import { formatBytes, groupIntoStudies } from './studies'

function tags(overrides: Partial<DicomTags> = {}): DicomTags {
  return {
    studyUID: 'study-1',
    seriesUID: 'series-1',
    sopUID: '',
    sopClassUID: '',
    modality: 'CT',
    studyDescription: 'Chest',
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
    imageOrientation: null,
    imagePosition: null,
    patientOrientation: null,
    accession: 'ACC1',
    burnedInAnnotation: '',
    summary: {},
    ...overrides,
  }
}

function instance(id: string, overrides: Partial<DicomTags> = {}, bytes = 100): RegisteredInstance {
  return { imageIds: [id], bytes, tags: tags(overrides) }
}

describe('groupIntoStudies', () => {
  test('groups instances into studies and series', () => {
    const studies = groupIntoStudies([
      instance('a', { seriesUID: 's1' }),
      instance('b', { seriesUID: 's2', seriesNumber: 2 }),
      instance('c', { studyUID: 'study-2', seriesUID: 's3' }),
      instance('d', { seriesUID: 's1' }),
    ])
    expect(studies).toHaveLength(2)
    const [first, second] = studies
    expect(first.series.map((s) => [s.seriesUID, s.imageIds])).toEqual([
      ['s1', ['a', 'd']],
      ['s2', ['b']],
    ])
    expect(second.series.map((s) => s.seriesUID)).toEqual(['s3'])
  })

  test('summarises the study for the studies table', () => {
    const [study] = groupIntoStudies([instance('a', {}, 1000), instance('b', {}, 500)])
    expect(study).toMatchObject({
      studyUID: 'study-1',
      description: 'Chest',
      patient: 'Doe Jane',
      date: '2024-01-31',
      modality: 'CT',
      accession: 'ACC1',
      imageCount: 2,
      bytes: 1500,
    })
  })

  test('orders series by series number', () => {
    const [study] = groupIntoStudies([
      instance('a', { seriesUID: 's3', seriesNumber: 3 }),
      instance('b', { seriesUID: 's1', seriesNumber: 1 }),
      instance('c', { seriesUID: 's2', seriesNumber: 2 }),
    ])
    expect(study.series.map((s) => s.seriesNumber)).toEqual([1, 2, 3])
  })

  test('orders slices by position along the slice normal', () => {
    const axial = [1, 0, 0, 0, 1, 0]
    const [study] = groupIntoStudies([
      instance('z20', { instanceNumber: 1, imageOrientation: axial, imagePosition: [0, 0, 20] }),
      instance('z0', { instanceNumber: 2, imageOrientation: axial, imagePosition: [0, 0, 0] }),
      instance('z10', { instanceNumber: 3, imageOrientation: axial, imagePosition: [0, 0, 10] }),
    ])
    expect(study.series[0].imageIds).toEqual(['z20', 'z10', 'z0'])
  })

  test('multi-frame instances contribute every frame, in order', () => {
    const multiFrame: RegisteredInstance = {
      imageIds: ['mf?frame=1', 'mf?frame=2', 'mf?frame=3'],
      bytes: 3000,
      tags: tags({ numberOfFrames: 3, instanceNumber: 2 }),
    }
    const [study] = groupIntoStudies([multiFrame, instance('single', { instanceNumber: 1 })])
    expect(study.series[0].imageIds).toEqual(['single', 'mf?frame=1', 'mf?frame=2', 'mf?frame=3'])
    expect(study.imageCount).toBe(4)
  })

  test('files without UIDs each become their own study', () => {
    const studies = groupIntoStudies([
      instance('a', { studyUID: '', seriesUID: '' }),
      instance('b', { studyUID: '', seriesUID: '' }),
    ])
    expect(studies).toHaveLength(2)
  })

  test('falls back to readable labels when tags are missing', () => {
    const [study] = groupIntoStudies([
      instance('a', { studyDescription: '', seriesDescription: '', patientName: '', modality: '', studyDate: '' }),
    ])
    expect(study).toMatchObject({ description: 'Untitled study', patient: 'Anonymous', modality: '—', date: '—' })
    expect(study.series[0]).toMatchObject({ description: 'Series', modality: '—' })
  })

  test('uses the series description when the study has none', () => {
    const [study] = groupIntoStudies([instance('a', { studyDescription: '' })])
    expect(study.description).toBe('Axial')
  })
})

describe('formatBytes', () => {
  test.each([
    [512, '512 B'],
    [2048, '2 KB'],
    [5 * 1024 * 1024, '5 MB'],
    [1.5 * 1024 * 1024 * 1024, '1.5 GB'],
  ])('%i → %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected)
  })
})
