import { describe, expect, test } from 'vitest'
import { strToU8, zipSync, type Zippable } from 'fflate'
import { readZip, ZipError } from './zip'

const zipBlob = (entries: Zippable, level: 0 | 6 = 6) =>
  new Blob([zipSync(entries, { level }) as Uint8Array<ArrayBuffer>])

async function contents(zip: Blob): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const entry of await readZip(zip)) out[entry.path] = await (await entry.extract()).text()
  return out
}

/** A one-entry archive that uses ZIP64 records for every size and offset. */
function zip64(name: string, text: string): Blob {
  const nameBytes = strToU8(name)
  const data = strToU8(text)
  const parts: Uint8Array[] = []
  const record = (size: number, fill: (v: DataView) => void) => {
    const bytes = new Uint8Array(size)
    fill(new DataView(bytes.buffer))
    parts.push(bytes)
  }
  const at = () => parts.reduce((n, p) => n + p.length, 0)

  record(30, (v) => {
    v.setUint32(0, 0x04034b50, true)
    v.setUint16(4, 45, true)
    v.setUint32(18, 0xffffffff, true)
    v.setUint32(22, 0xffffffff, true)
    v.setUint16(26, nameBytes.length, true)
    v.setUint16(28, 20, true)
  })
  parts.push(nameBytes)
  record(20, (v) => {
    v.setUint16(0, 1, true)
    v.setUint16(2, 16, true)
    v.setBigUint64(4, BigInt(data.length), true)
    v.setBigUint64(12, BigInt(data.length), true)
  })
  parts.push(data)

  const cdOffset = at()
  record(46, (v) => {
    v.setUint32(0, 0x02014b50, true)
    v.setUint16(4, 45, true)
    v.setUint16(6, 45, true)
    v.setUint32(20, 0xffffffff, true)
    v.setUint32(24, 0xffffffff, true)
    v.setUint16(28, nameBytes.length, true)
    v.setUint16(30, 28, true)
    v.setUint32(42, 0xffffffff, true)
  })
  parts.push(nameBytes)
  record(28, (v) => {
    v.setUint16(0, 1, true)
    v.setUint16(2, 24, true)
    v.setBigUint64(4, BigInt(data.length), true)
    v.setBigUint64(12, BigInt(data.length), true)
    v.setBigUint64(20, 0n, true)
  })
  const cdSize = at() - cdOffset

  const zip64EocdOffset = at()
  record(56, (v) => {
    v.setUint32(0, 0x06064b50, true)
    v.setBigUint64(4, 44n, true)
    v.setBigUint64(24, 1n, true)
    v.setBigUint64(32, 1n, true)
    v.setBigUint64(40, BigInt(cdSize), true)
    v.setBigUint64(48, BigInt(cdOffset), true)
  })
  record(20, (v) => {
    v.setUint32(0, 0x07064b50, true)
    v.setBigUint64(8, BigInt(zip64EocdOffset), true)
    v.setUint32(16, 1, true)
  })
  record(22, (v) => {
    v.setUint32(0, 0x06054b50, true)
    v.setUint16(8, 0xffff, true)
    v.setUint16(10, 0xffff, true)
    v.setUint32(12, 0xffffffff, true)
    v.setUint32(16, 0xffffffff, true)
  })
  return new Blob(parts as Uint8Array<ArrayBuffer>[])
}

describe('readZip', () => {
  test('reads deflated entries', async () => {
    const big = 'x'.repeat(100_000)
    expect(await contents(zipBlob({ 'a/IM0001': strToU8('one'), IM0002: strToU8(big) }))).toEqual({
      'a/IM0001': 'one',
      IM0002: big,
    })
  })

  test('reads stored entries', async () => {
    expect(await contents(zipBlob({ IM0001: strToU8('one') }, 0))).toEqual({ IM0001: 'one' })
  })

  test('lists sizes and skips folders', async () => {
    const entries = await readZip(zipBlob({ 'dir/': {}, 'dir/IM0001': strToU8('four') }))
    expect(entries.map(({ path, size }) => ({ path, size }))).toEqual([
      { path: 'dir/IM0001', size: 4 },
    ])
  })

  test('reads ZIP64 archives', async () => {
    expect(await contents(zip64('IM0001.dcm', 'hello'))).toEqual({ 'IM0001.dcm': 'hello' })
  })

  test('finds the directory behind an archive comment', async () => {
    const bytes = zipSync({ IM0001: strToU8('one') })
    const commented = new Uint8Array(bytes.length + 5)
    commented.set(bytes)
    commented.set(strToU8('hello'), bytes.length)
    new DataView(commented.buffer).setUint16(bytes.length - 2, 5, true)
    expect(await contents(new Blob([commented]))).toEqual({ IM0001: 'one' })
  })

  test('rejects files that are not zips', async () => {
    await expect(readZip(new Blob(['not a zip']))).rejects.toBeInstanceOf(ZipError)
  })

  test('rejects encrypted archives', async () => {
    const bytes = zipSync({ IM0001: strToU8('one') })
    const view = new DataView(bytes.buffer)
    const eocd = bytes.length - 22
    const cd = view.getUint32(eocd + 16, true)
    view.setUint16(cd + 8, 1, true)
    await expect(readZip(new Blob([bytes as Uint8Array<ArrayBuffer>]))).rejects.toThrow('Encrypted')
  })
})
