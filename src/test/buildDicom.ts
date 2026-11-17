/**
 * Minimal DICOM Part 10 writer for unit tests (explicit VR little endian,
 * defined lengths). Lets tests build exactly the dataset they need instead of
 * depending on sample files.
 */

export type DicomValue = string | number[] | Uint8Array | DicomDataset[]
/** Elements keyed by "GGGGEEEE" hex tag. */
export type DicomDataset = Record<string, [vr: string, value: DicomValue]>

export const EXPLICIT_VR_LITTLE_ENDIAN = '1.2.840.10008.1.2.1'

const LONG_LENGTH_VRS = new Set(['OB', 'OD', 'OF', 'OL', 'OV', 'OW', 'SQ', 'SV', 'UC', 'UN', 'UR', 'UT', 'UV'])

const NUMBER_WRITERS: Record<string, [size: number, write: (view: DataView, offset: number, n: number) => void]> = {
  US: [2, (v, o, n) => v.setUint16(o, n, true)],
  SS: [2, (v, o, n) => v.setInt16(o, n, true)],
  UL: [4, (v, o, n) => v.setUint32(o, n, true)],
  SL: [4, (v, o, n) => v.setInt32(o, n, true)],
  FL: [4, (v, o, n) => v.setFloat32(o, n, true)],
  FD: [8, (v, o, n) => v.setFloat64(o, n, true)],
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function tagBytes(tag: string): Uint8Array {
  const bytes = new Uint8Array(4)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, parseInt(tag.slice(0, 4), 16), true)
  view.setUint16(2, parseInt(tag.slice(4, 8), 16), true)
  return bytes
}

function u32(n: number): Uint8Array {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, n, true)
  return bytes
}

function encodeValue(vr: string, value: DicomValue): Uint8Array {
  if (vr === 'SQ') {
    const items = (value as DicomDataset[]).map((item) => {
      const body = encodeDataset(item)
      return concat([tagBytes('FFFEE000'), u32(body.length), body])
    })
    return concat(items)
  }
  if (value instanceof Uint8Array) {
    return value.length % 2 ? concat([value, new Uint8Array(1)]) : value
  }
  if (Array.isArray(value)) {
    const [size, write] = NUMBER_WRITERS[vr]
    const bytes = new Uint8Array(size * value.length)
    const view = new DataView(bytes.buffer)
    ;(value as number[]).forEach((n, i) => write(view, i * size, n))
    return bytes
  }
  const text = new TextEncoder().encode(value)
  if (text.length % 2 === 0) return text
  return concat([text, new Uint8Array([vr === 'UI' ? 0 : 0x20])])
}

function encodeElement(tag: string, vr: string, value: DicomValue): Uint8Array {
  const body = encodeValue(vr, value)
  const vrBytes = new TextEncoder().encode(vr)
  if (LONG_LENGTH_VRS.has(vr)) {
    return concat([tagBytes(tag), vrBytes, new Uint8Array(2), u32(body.length), body])
  }
  const length = new Uint8Array(2)
  new DataView(length.buffer).setUint16(0, body.length, true)
  return concat([tagBytes(tag), vrBytes, length, body])
}

function encodeDataset(dataset: DicomDataset): Uint8Array {
  return concat(
    Object.keys(dataset)
      .map((tag) => tag.toUpperCase())
      .sort()
      .map((tag) => {
        const [vr, value] = dataset[tag] ?? dataset[tag.toLowerCase()]
        return encodeElement(tag, vr, value)
      }),
  )
}

export function buildDicom(
  dataset: DicomDataset,
  { transferSyntax = EXPLICIT_VR_LITTLE_ENDIAN } = {},
): Uint8Array {
  const meta = encodeDataset({
    '00020001': ['OB', new Uint8Array([0, 1])],
    '00020002': ['UI', '1.2.840.10008.5.1.4.1.1.4'],
    '00020003': ['UI', '1.2.3.4.5'],
    '00020010': ['UI', transferSyntax],
  })
  const groupLength = encodeElement('00020000', 'UL', [meta.length])
  const preamble = new Uint8Array(128)
  const magic = new TextEncoder().encode('DICM')
  return concat([preamble, magic, groupLength, meta, encodeDataset(dataset)])
}
