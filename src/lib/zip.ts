/**
 * A streaming zip reader. Only the central directory is read up front; each
 * entry is then sliced from the archive and inflated on its own with the
 * browser's DecompressionStream. Archives of any size work without holding the
 * whole archive, or all of its contents, in memory at once. Supports ZIP64.
 */

export interface ZipEntry {
  /** Path inside the archive, with "/" separators. */
  path: string
  compressedSize: number
  size: number
  /** Extract the entry. Stored entries are sliced from the archive without copying. */
  extract(): Promise<Blob>
}

export class ZipError extends Error {}

const EOCD_SIGNATURE = 0x06054b50
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50
const ZIP64_EOCD_SIGNATURE = 0x06064b50
const CENTRAL_HEADER_SIGNATURE = 0x02014b50
const LOCAL_HEADER_SIGNATURE = 0x04034b50
const EOCD_SIZE = 22
const MAX_COMMENT = 0xffff
const STORED = 0
const DEFLATED = 8

async function view(blob: Blob, start: number, end: number): Promise<DataView> {
  return new DataView(await blob.slice(start, end).arrayBuffer())
}

const u64 = (v: DataView, offset: number) => Number(v.getBigUint64(offset, true))

/** Where the central directory is and how many entries it has. */
async function findCentralDirectory(zip: Blob) {
  const tailStart = Math.max(0, zip.size - EOCD_SIZE - MAX_COMMENT)
  const tail = await view(zip, tailStart, zip.size)
  let eocd = -1
  for (let i = tail.byteLength - EOCD_SIZE; i >= 0; i--) {
    if (tail.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new ZipError('Not a zip archive.')

  let entries = tail.getUint16(eocd + 10, true)
  let size = tail.getUint32(eocd + 12, true)
  let offset = tail.getUint32(eocd + 16, true)

  const locator = eocd - 20
  if (locator >= 0 && tail.getUint32(locator, true) === ZIP64_LOCATOR_SIGNATURE) {
    const zip64Offset = u64(tail, locator + 8)
    const record = await view(zip, zip64Offset, zip64Offset + 56)
    if (record.getUint32(0, true) !== ZIP64_EOCD_SIGNATURE) {
      throw new ZipError('Damaged ZIP64 archive.')
    }
    entries = u64(record, 32)
    size = u64(record, 40)
    offset = u64(record, 48)
  }
  return { entries, size, offset }
}

/** Read the sizes and offset that ZIP64 moves into the extra field. */
function applyZip64Extra(
  extra: DataView,
  entry: { size: number; compressedSize: number; localOffset: number },
) {
  for (let i = 0; i + 4 <= extra.byteLength; ) {
    const id = extra.getUint16(i, true)
    const length = extra.getUint16(i + 2, true)
    if (id === 0x0001) {
      let field = i + 4
      for (const key of ['size', 'compressedSize', 'localOffset'] as const) {
        if (entry[key] === 0xffffffff) {
          entry[key] = u64(extra, field)
          field += 8
        }
      }
      return
    }
    i += 4 + length
  }
}

async function inflate(data: Blob): Promise<Blob> {
  const stream = data.stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Response(stream).blob()
}

/** List the files in a zip archive. Throws a ZipError if it cannot be read. */
export async function readZip(zip: Blob): Promise<ZipEntry[]> {
  const directory = await findCentralDirectory(zip)
  const cd = await view(zip, directory.offset, directory.offset + directory.size)
  const utf8 = new TextDecoder()
  const entries: ZipEntry[] = []

  let p = 0
  for (let n = 0; n < directory.entries; n++) {
    if (p + 46 > cd.byteLength || cd.getUint32(p, true) !== CENTRAL_HEADER_SIGNATURE) {
      throw new ZipError('Damaged zip archive.')
    }
    const flags = cd.getUint16(p + 8, true)
    const method = cd.getUint16(p + 10, true)
    const nameLength = cd.getUint16(p + 28, true)
    const extraLength = cd.getUint16(p + 30, true)
    const commentLength = cd.getUint16(p + 32, true)
    const entry = {
      compressedSize: cd.getUint32(p + 20, true),
      size: cd.getUint32(p + 24, true),
      localOffset: cd.getUint32(p + 42, true),
    }
    const path = utf8.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLength))
    applyZip64Extra(
      new DataView(cd.buffer, cd.byteOffset + p + 46 + nameLength, extraLength),
      entry,
    )
    p += 46 + nameLength + extraLength + commentLength

    if (path.endsWith('/')) continue
    if (flags & 1) throw new ZipError('Encrypted zip archives are not supported.')
    if (method !== STORED && method !== DEFLATED) {
      throw new ZipError(`Unsupported zip compression method ${method}.`)
    }

    entries.push({
      path,
      compressedSize: entry.compressedSize,
      size: entry.size,
      async extract() {
        const local = await view(zip, entry.localOffset, entry.localOffset + 30)
        if (local.getUint32(0, true) !== LOCAL_HEADER_SIGNATURE) {
          throw new ZipError('Damaged zip archive.')
        }
        const start =
          entry.localOffset + 30 + local.getUint16(26, true) + local.getUint16(28, true)
        const data = zip.slice(start, start + entry.compressedSize)
        return method === STORED ? data : inflate(data)
      },
    })
  }
  return entries
}
