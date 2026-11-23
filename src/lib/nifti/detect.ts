/** Recognise NIfTI files and read them, transparently gunzipping `.nii.gz`. */
import { gunzip } from 'fflate'

const NIFTI_EXT = /\.nii(\.gz)?$/i
const GZIP_MAGIC = [0x1f, 0x8b]

/** NIfTI header sizes, used to recognise an uncompressed, unnamed file. */
const HEADER_SIZES = new Set([348, 540])

function isNiftiHeaderStart(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return HEADER_SIZES.has(view.getInt32(0, true)) || HEADER_SIZES.has(view.getInt32(0, false))
}

/**
 * Cheap pre-filter: a `.nii`/`.nii.gz` name, or — for files named by something
 * else — gzip magic or a NIfTI header size in the first bytes. The header is
 * validated for real when the file is parsed, so false positives are harmless.
 */
export async function looksLikeNifti(file: File): Promise<boolean> {
  if (NIFTI_EXT.test(file.name)) return true
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer())
  if (head[0] === GZIP_MAGIC[0] && head[1] === GZIP_MAGIC[1]) return true
  return isNiftiHeaderStart(head)
}

function gunzipAsync(data: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    gunzip(data, (err, out) => (err ? reject(err) : resolve(out)))
  })
}

/** Read a NIfTI file's bytes, decompressing if it is gzip-compressed. */
export async function readNiftiBytes(file: File): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.length >= 2 && bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1]) {
    // fflate's buffer is ArrayBuffer-backed; the generic just isn't narrowed.
    return (await gunzipAsync(bytes)) as Uint8Array<ArrayBuffer>
  }
  return bytes
}
