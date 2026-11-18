/**
 * Turn a dicom-parser DataSet into display rows: tag, VR, keyword and a
 * human-readable value. Used both for the full-header dialog and for the
 * curated fields in the inspector.
 */
import dcmjs from 'dcmjs'
import dicomParser, { type DataSet, type Element } from 'dicom-parser'
import { charsetOf, decoderFor, readString, usesCharset, type Decode } from '@/lib/dicom/charset'

const { dictionary, nameMap } = dcmjs.data.DicomMetaDictionary

export interface HeaderRow {
  /** Unique within one header, for React keys. */
  id: string
  /** "(GGGG,EEEE)" */
  tag: string
  vr: string
  name: string
  value: string
  /** Sequence nesting level; 0 for top-level elements. */
  depth: number
  kind: 'element' | 'sequence' | 'item'
}

const MAX_VALUE_CHARS = 1024
const MAX_BINARY_VALUES = 32

const STRING_VRS = new Set([
  'AE', 'AS', 'CS', 'DA', 'DS', 'DT', 'IS', 'LO', 'PN', 'SH', 'TM', 'UC', 'UI', 'UR',
])
const TEXT_VRS = new Set(['LT', 'ST', 'UT'])
const NUMERIC_VRS: Record<string, { size: number; read: keyof DataSet }> = {
  US: { size: 2, read: 'uint16' },
  SS: { size: 2, read: 'int16' },
  UL: { size: 4, read: 'uint32' },
  SL: { size: 4, read: 'int32' },
  FL: { size: 4, read: 'float' },
  FD: { size: 8, read: 'double' },
}

/** 'x0020000e' → '(0020,000E)' */
export function formatTag(tag: string): string {
  const hex = tag.slice(1).toUpperCase()
  return `(${hex.slice(0, 4)},${hex.slice(4)})`
}

/** 'PatientName' → 'x00100010' */
export function tagForKeyword(keyword: string): string | undefined {
  const entry = nameMap[keyword]
  return entry ? `x${entry.tag.replace(/[(),]/g, '').toLowerCase()}` : undefined
}

function describe(ds: DataSet, element: Element): { name: string; vr: string } {
  const tag = formatTag(element.tag)
  const group = parseInt(element.tag.slice(1, 5), 16)
  const elementNo = parseInt(element.tag.slice(5), 16)
  const entry = dictionary[tag]

  let name = entry?.name ?? ''
  if (!name) {
    if (elementNo === 0) name = 'GroupLength'
    else if (group % 2 === 1)
      name = elementNo >= 0x10 && elementNo <= 0xff ? 'PrivateCreator' : 'Private'
  }

  let vr = element.vr ?? entry?.vr ?? 'UN'
  if (vr === 'xs') vr = ds.uint16('x00280103') === 1 ? 'SS' : 'US'
  else if (vr === 'ox') vr = 'OW'
  else if (!element.vr && elementNo >= 0x10 && elementNo <= 0xff && group % 2 === 1)
    vr = 'LO'
  return { name, vr }
}

function bytesOf(ds: DataSet, element: Element): Uint8Array {
  return ds.byteArray.subarray(element.dataOffset, element.dataOffset + element.length)
}

/** Unknown / private data: show as text when it is clearly printable ASCII. */
function printableOrBinary(bytes: Uint8Array): string {
  if (bytes.length > 0 && bytes.length <= MAX_VALUE_CHARS) {
    let printable = true
    for (const b of bytes) {
      if (b !== 0 && (b < 0x20 || b > 0x7e)) {
        printable = false
        break
      }
    }
    if (printable) return String.fromCharCode(...bytes).replace(/[\0 ]+$/, '')
  }
  return `<binary, ${bytes.length.toLocaleString()} bytes>`
}

const latin1 = decoderFor(undefined)

/** `decode` is for text in the dataset's character set; other strings are ASCII. */
export function formatValue(
  ds: DataSet,
  element: Element,
  vr: string,
  decode: Decode = latin1,
): string {
  const { tag, length } = element
  if (length === 0 && !element.encapsulatedPixelData) return ''

  if (tag === 'x7fe00010' || tag === 'x7fe00008' || tag === 'x7fe00009') {
    const frags = element.fragments?.length
    return frags
      ? `<pixel data, ${frags} fragment${frags > 1 ? 's' : ''}>`
      : `<pixel data, ${length.toLocaleString()} bytes>`
  }

  const textDecode = usesCharset(vr) ? decode : latin1
  if (STRING_VRS.has(vr)) return readString(ds, tag, textDecode) ?? ''
  if (TEXT_VRS.has(vr)) return readString(ds, tag, textDecode, { keepLeading: true }) ?? ''

  const numeric = NUMERIC_VRS[vr]
  if (numeric) {
    const count = Math.floor(length / numeric.size)
    const read = ds[numeric.read] as (t: string, i: number) => number | undefined
    const values: string[] = []
    for (let i = 0; i < Math.min(count, MAX_BINARY_VALUES); i++) {
      const v = read.call(ds, tag, i)
      values.push(v === undefined ? '?' : String(v))
    }
    const more = count > MAX_BINARY_VALUES ? ` … (${count} values)` : ''
    return values.join('\\') + more
  }

  if (vr === 'AT') {
    const at = ds.attributeTag(tag)
    return at ? formatTag(at) : ''
  }

  return printableOrBinary(bytesOf(ds, element))
}

/** The decoder for a dataset: its own character set, else the one it is nested in. */
function decoderOf(ds: DataSet, inherited: Decode = latin1): Decode {
  return ds.elements.x00080005 ? decoderFor(charsetOf(ds)) : inherited
}

function walk(ds: DataSet, depth: number, prefix: string, out: HeaderRow[], inherited?: Decode) {
  const decode = decoderOf(ds, inherited)
  const tags = Object.keys(ds.elements).sort()
  for (const t of tags) {
    const element = ds.elements[t]
    const { name, vr } = describe(ds, element)
    const id = `${prefix}${t}`

    if (element.items) {
      const n = element.items.length
      out.push({
        id,
        tag: formatTag(t),
        vr: 'SQ',
        name,
        value: `${n} item${n === 1 ? '' : 's'}`,
        depth,
        kind: 'sequence',
      })
      element.items.forEach((item, i) => {
        out.push({
          id: `${id}/${i}`,
          tag: '(FFFE,E000)',
          vr: '',
          name: `Item ${i + 1}`,
          value: '',
          depth: depth + 1,
          kind: 'item',
        })
        if (item.dataSet) walk(item.dataSet, depth + 2, `${id}/${i}/`, out, decode)
      })
      continue
    }

    let value = formatValue(ds, element, vr, decode)
    if (value.length > MAX_VALUE_CHARS) value = `${value.slice(0, MAX_VALUE_CHARS)}…`
    out.push({ id, tag: formatTag(t), vr, name, value, depth, kind: 'element' })
  }
}

export function datasetToRows(ds: DataSet): HeaderRow[] {
  const rows: HeaderRow[] = []
  walk(ds, 0, '', rows)
  return rows
}

/** Parse a File on demand and return every element, including sequences. */
export async function readHeaderRows(file: File): Promise<HeaderRow[]> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  return datasetToRows(dicomParser.parseDicom(bytes))
}

/** Look up and format a single top-level element by keyword. */
export function valueForKeyword(
  ds: DataSet,
  keyword: string,
  decode: Decode = decoderOf(ds),
): string {
  const tag = tagForKeyword(keyword)
  const element = tag ? ds.elements[tag] : undefined
  if (!element || element.items) return ''
  return formatValue(ds, element, describe(ds, element).vr, decode).trim()
}
