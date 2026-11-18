import { describe, expect, test } from 'vitest'
import dicomParser from 'dicom-parser'
import { buildDicom } from '@/test/buildDicom'
import { decoderFor, readString } from './charset'
import { datasetToRows } from './header'
import { parseTags } from './parse'
import { extractSummary } from './summary'

const ESC = 0x1b
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0))
const bytes = (...parts: (number | number[])[]) => new Uint8Array(parts.flat())

describe('decoderFor', () => {
  test.each([
    ['ISO_IR 192', new TextEncoder().encode('Müller^Jürgen'), 'Müller^Jürgen'],
    ['ISO_IR 100', bytes(ascii('M'), 0xfc, ascii('ller')), 'Müller'],
    ['ISO_IR 101', bytes(ascii('Dvo'), 0xf8, 0xe1, ascii('k')), 'Dvořák'],
    ['ISO_IR 144', bytes(0xb8, 0xd2, 0xd0, 0xdd), 'Иван'],
    [undefined, bytes(ascii('M'), 0xfc, ascii('ller')), 'Müller'],
    ['ISO_IR 999', bytes(ascii('M'), 0xfc, ascii('ller')), 'Müller'],
  ])('%s', (charset, input, expected) => {
    expect(decoderFor(charset)(input)).toBe(expected)
  })

  test('Japanese with ISO 2022 escape sequences (PS3.5 H.3.1)', () => {
    const toKanji = [ESC, ...ascii('$B')]
    const toAscii = [ESC, ...ascii('(B')]
    const name = bytes(
      ascii('Yamada^Tarou='),
      toKanji, 0x3b, 0x33, 0x45, 0x44, toAscii,
      ascii('^'),
      toKanji, 0x42, 0x40, 0x4f, 0x3a, toAscii,
    )
    expect(decoderFor('\\ISO 2022 IR 87')(name)).toBe('Yamada^Tarou=山田^太郎')
  })

  test('Korean with ISO 2022 escape sequences (PS3.5 I.2)', () => {
    const toHangul = [ESC, ...ascii('$)C')]
    const name = bytes(
      ascii('Hong^Gildong='),
      toHangul, 0xc8, 0xab,
      ascii('^'),
      toHangul, 0xb1, 0xe6, 0xb5, 0xbf,
    )
    expect(decoderFor('\\ISO 2022 IR 149')(name)).toBe('Hong^Gildong=홍^길동')
  })

  test('drops escape sequences in other ISO 2022 sets', () => {
    const name = bytes(ESC, ascii('-A'), ascii('M'), 0xfc, ascii('ller'))
    expect(decoderFor('ISO 2022 IR 6\\ISO 2022 IR 100')(name)).toBe('Müller')
  })
})

describe('readString', () => {
  const ds = dicomParser.parseDicom(
    buildDicom({ '00100010': ['PN', ' Doe^Jane '], '00104000': ['LT', '  indented  '] }),
  )
  const decode = decoderFor(undefined)

  test('trims like dicom-parser', () => {
    expect(readString(ds, 'x00100010', decode)).toBe('Doe^Jane')
    expect(readString(ds, 'x00104000', decode, { keepLeading: true })).toBe('  indented')
    expect(readString(ds, 'x00100020', decode)).toBeUndefined()
  })
})

describe('reading files', () => {
  const utf8 = buildDicom({
    '00080005': ['CS', 'ISO_IR 192'],
    '00080080': ['LO', 'Universitätsklinikum Köln'],
    '00100010': ['PN', 'Müller^Jürgen'],
    '00081140': [
      'SQ',
      [{ '00081150': ['UI', '1.2.3'], '00400254': ['LO', 'Schädel'] }],
    ],
    '00280010': ['US', [1]],
    '7FE00010': ['OW', new Uint8Array(2)],
  })

  test('the studies list and viewer use the character set', () => {
    expect(parseTags(utf8).patientName).toBe('Müller Jürgen')
  })

  test('the header panel uses the character set', () => {
    const summary = extractSummary(dicomParser.parseDicom(utf8))
    expect(summary.PatientName).toBe('Müller^Jürgen')
    expect(summary.InstitutionName).toBe('Universitätsklinikum Köln')
  })

  test('the full header uses it too, including inside sequences', () => {
    const rows = datasetToRows(dicomParser.parseDicom(utf8))
    const value = (name: string) => rows.find((r) => r.name === name)?.value
    expect(value('PatientName')).toBe('Müller^Jürgen')
    expect(value('PerformedProcedureStepDescription')).toBe('Schädel')
  })
})
