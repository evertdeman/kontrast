import { describe, expect, test } from 'vitest'
import dicomParser from 'dicom-parser'
import { buildDicom, type DicomDataset } from '@/test/buildDicom'
import {
  checkEdit,
  createTagEditor,
  notEditableReason,
  resolveTag,
  type ResolvedTag,
  type TagEdit,
} from './editTags'

const CT_IMAGE_STORAGE = '1.2.840.10008.5.1.4.1.1.2'

function file(sopInstanceUid: string, seriesUid = '1.2.3.2', extra: DicomDataset = {}): ArrayBuffer {
  const bytes = buildDicom({
    '00080016': ['UI', CT_IMAGE_STORAGE],
    '00080018': ['UI', sopInstanceUid],
    '00080060': ['CS', 'CT'],
    '00100010': ['PN', 'Doe^Jane'],
    '00100020': ['LO', 'PID-1'],
    '0020000D': ['UI', '1.2.3.1'],
    '0020000E': ['UI', seriesUid],
    '00280010': ['US', [2]],
    '7FE00010': ['OW', new Uint8Array(8)],
    ...extra,
  })
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

const tag = (input: string) => resolveTag(input) as ResolvedTag
const edit = (input: string, value: string, extra: Partial<TagEdit> = {}): TagEdit => ({
  tag: tag(input),
  action: 'set',
  value,
  seriesUID: null,
  ...extra,
})
const parse = (bytes: ArrayBuffer) => dicomParser.parseDicom(new Uint8Array(bytes))

describe('resolveTag', () => {
  test.each(['PatientName', '(0010,0010)', '00100010', '0010,0010'])('finds %s', (input) => {
    expect(resolveTag(input)).toEqual({ tag: '00100010', keyword: 'PatientName', vr: 'PN' })
  })

  test('maps dictionary VRs that depend on the image', () => {
    expect(resolveTag('SmallestImagePixelValue')?.vr).toBe('US')
  })

  test.each(['Nonsense', '', '(gggg,eeee)'])('rejects %j', (input) => {
    expect(resolveTag(input)).toBeNull()
  })
})

describe('checkEdit', () => {
  test.each(['TransferSyntaxUID', 'PixelData', 'ReferencedImageSequence'])(
    '%s cannot be edited',
    (input) => {
      expect(notEditableReason(tag(input))).not.toBeNull()
      expect(checkEdit(edit(input, 'x'))[0].level).toBe('error')
    },
  )

  test('blocks numbers that do not fit binary VRs', () => {
    expect(checkEdit(edit('Rows', '70000'))[0]).toMatchObject({ level: 'error' })
    expect(checkEdit(edit('Rows', 'abc'))[0]).toMatchObject({ level: 'error' })
    expect(checkEdit(edit('Rows', '512'))).toEqual([])
  })

  test('warns about values that break the standard but allows them', () => {
    const issues = checkEdit(edit('StudyDate', '2024-01-31'))
    expect(issues.every((i) => i.level === 'warning')).toBe(true)
    expect(issues).toContainEqual(expect.objectContaining({ message: expect.stringContaining('YYYYMMDD') }))
    expect(checkEdit(edit('StudyID', 'X'.repeat(20)))).toEqual([
      expect.objectContaining({ level: 'warning', message: expect.stringContaining('at most 16') }),
    ])
    expect(checkEdit(edit('StudyDate', '20240131'))).toEqual([])
  })

  test('removing or emptying is always allowed', () => {
    expect(checkEdit(edit('StudyDate', 'whatever', { action: 'remove' }))).toEqual([])
    expect(checkEdit(edit('Rows', ''))).toEqual([])
  })
})

describe('createTagEditor', () => {
  test('sets, adds and removes elements', () => {
    const editor = createTagEditor(
      [
        edit('PatientName', 'Test^Patient'),
        edit('StudyDate', 'not a date'),
        edit('PatientID', '', { action: 'remove' }),
        edit('ImagePositionPatient', '1\\2\\3'),
      ],
      { newUids: false },
    )
    const ds = parse(editor.edit(file('1.2.3.10'), '1.2.3.2'))
    expect(ds.string('x00100010')).toBe('Test^Patient')
    expect(ds.string('x00080020')).toBe('not a date')
    expect(ds.elements.x00100020).toBeUndefined()
    expect(ds.string('x00200032')).toBe('1\\2\\3')
    expect(ds.string('x00080018')).toBe('1.2.3.10')
  })

  test('applies an edit only to its series', () => {
    const editor = createTagEditor([edit('Modality', 'MR', { seriesUID: 'b' })], { newUids: false })
    expect(parse(editor.edit(file('1.2.3.10', 'a'), 'a')).string('x00080060')).toBe('CT')
    expect(parse(editor.edit(file('1.2.3.11', 'b'), 'b')).string('x00080060')).toBe('MR')
  })

  test('gives new UIDs consistently across files, but keeps typed-in ones', () => {
    const editor = createTagEditor([edit('SeriesDescription', 'Edited')], { newUids: true })
    const a = parse(editor.edit(file('1.2.3.10'), '1.2.3.2'))
    const b = parse(editor.edit(file('1.2.3.11'), '1.2.3.2'))
    expect(a.string('x0020000d')).toMatch(/^2\.25\./)
    expect(b.string('x0020000d')).toBe(a.string('x0020000d'))
    expect(a.string('x00080018')).not.toBe(b.string('x00080018'))
    expect(a.string('x00020003')).toBe(a.string('x00080018'))
    expect(a.string('x00080016')).toBe(CT_IMAGE_STORAGE)

    const typed = createTagEditor([edit('StudyInstanceUID', '9.9.9')], { newUids: true })
    expect(parse(typed.edit(file('1.2.3.10'), '1.2.3.2')).string('x0020000d')).toBe('9.9.9')
  })

  test('declares UTF-8 when it writes accented text', () => {
    const editor = createTagEditor([edit('PatientName', 'Müller^Jürgen')], { newUids: false })
    const out = new Uint8Array(editor.edit(file('1.2.3.10'), '1.2.3.2'))
    const ds = dicomParser.parseDicom(out)
    expect(ds.string('x00080005')).toBe('ISO_IR 192')
    const name = ds.elements.x00100010
    expect(new TextDecoder().decode(out.subarray(name.dataOffset, name.dataOffset + name.length)).trim()).toBe(
      'Müller^Jürgen',
    )
  })
})
