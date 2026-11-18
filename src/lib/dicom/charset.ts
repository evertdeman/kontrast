/**
 * Decode DICOM text according to the file's Specific Character Set
 * (0008,0005). dicom-parser reads every string as Latin-1, which garbles
 * names in UTF-8 files ("Müller" becomes "MÃ¼ller") and in every other
 * character set.
 */
import type { DataSet } from 'dicom-parser'

export type Decode = (bytes: Uint8Array) => string

/** Value representations whose text uses the Specific Character Set; the rest are ASCII. */
export const CHARSET_VRS = new Set(['SH', 'LO', 'ST', 'LT', 'UT', 'PN', 'UC'])

/** Defined terms (without the "ISO 2022" prefix) and their WHATWG encoding labels. */
const ENCODINGS: Record<string, string> = {
  'IR 6': 'latin1',
  'IR 100': 'latin1',
  'IR 101': 'iso-8859-2',
  'IR 109': 'iso-8859-3',
  'IR 110': 'iso-8859-4',
  'IR 144': 'iso-8859-5',
  'IR 127': 'iso-8859-6',
  'IR 126': 'iso-8859-7',
  'IR 138': 'iso-8859-8',
  'IR 148': 'windows-1254',
  'IR 203': 'iso-8859-15',
  'IR 13': 'shift_jis',
  'IR 166': 'windows-874',
  'IR 192': 'utf-8',
  GB18030: 'gb18030',
  GBK: 'gbk',
}

const decoders = new Map<string, TextDecoder>()

function textDecoder(label: string): TextDecoder {
  let decoder = decoders.get(label)
  if (!decoder) {
    decoder = new TextDecoder(label)
    decoders.set(label, decoder)
  }
  return decoder
}

/** "ISO_IR 192" and "ISO 2022 IR 100" → "IR 192" and "IR 100". */
const normalise = (term: string) => term.trim().replace(/^ISO[_ ](2022 )?/, '')

/** ISO 2022 escape sequences, which switch character sets and are not text themselves. */
// eslint-disable-next-line no-control-regex -- matching ESC is the point
const ESCAPE_SEQUENCE = /\x1b[\x20-\x2f]*[\x30-\x7e]/g

/**
 * A decoder for a Specific Character Set value. Multi-valued (ISO 2022) sets
 * for Japanese, Korean and Chinese are decoded with the matching multi-byte
 * encoding; anything unknown falls back to Latin-1, as before.
 */
export function decoderFor(specificCharacterSet: string | undefined): Decode {
  const terms = (specificCharacterSet ?? '').split('\\').map(normalise)
  const has = (term: string) => terms.includes(term)

  // ISO-2022-JP interprets the escape sequences itself.
  if (has('IR 87') || has('IR 159')) {
    const decoder = textDecoder('iso-2022-jp')
    return (bytes) => decoder.decode(bytes)
  }
  // Korean and Chinese switch to EUC-style bytes, which these encodings read directly.
  const label = has('IR 149')
    ? 'euc-kr'
    : has('IR 58')
      ? 'gbk'
      : (ENCODINGS[terms.find((t) => t) ?? 'IR 6'] ?? 'latin1')
  const decoder = textDecoder(label)
  return (bytes) => decoder.decode(bytes).replace(ESCAPE_SEQUENCE, '')
}

export function charsetOf(ds: DataSet): string | undefined {
  return ds.string('x00080005')
}

/** Whether an element's text uses the character set, judged by its VR. */
export function usesCharset(vr: string | undefined): boolean {
  return !!vr && CHARSET_VRS.has(vr)
}

/**
 * Read a string element like dicom-parser's `string()`, but decoded with
 * `decode`: up to the first NUL, trimmed. Short and long text (ST, LT, UT)
 * keep their leading spaces, as in `text()`.
 */
export function readString(
  ds: DataSet,
  tag: string,
  decode: Decode,
  { keepLeading = false } = {},
): string | undefined {
  const element = ds.elements[tag]
  if (!element) return undefined
  if (element.length === 0) return ''
  let bytes = ds.byteArray.subarray(element.dataOffset, element.dataOffset + element.length)
  const nul = bytes.indexOf(0)
  if (nul >= 0) bytes = bytes.subarray(0, nul)
  const text = decode(bytes)
  return keepLeading ? text.replace(/\s+$/, '') : text.trim()
}
