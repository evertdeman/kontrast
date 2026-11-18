import { writeFileSync } from 'node:fs'
import path from 'node:path'
import dicomParser from 'dicom-parser'
import { tempDir } from './data'
import {
  expect,
  openButtons,
  openFiles,
  openSample,
  openViewer,
  SLOW,
  savedZip,
  sliceCounter,
  studyAction,
  studyRow,
  stubSavePicker,
  test,
} from './fixtures'

test.beforeEach(async ({ page }) => {
  await stubSavePicker(page)
  await openSample(page)
})

test('saves an anonymised zip that opens again in Kontrast', async ({ page }) => {
  await studyAction(page, studyRow(page, 'Sample'), 'Anonymise…')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('96 files')
  await expect(dialog).not.toContainText('burned into')
  await expect(dialog.getByRole('radio', { name: 'Shift' })).toBeChecked()
  await dialog.getByRole('checkbox', { name: 'Sex' }).check()
  await dialog.getByRole('button', { name: 'Save zip' }).click()

  const { name, bytes, entries } = await savedZip(page)
  expect(name).toBe('anonymised-ct-study.zip')
  const paths = Object.keys(entries).sort()
  expect(paths).toHaveLength(96)
  expect(paths[0]).toBe('series-01/0001.dcm')

  const ds = dicomParser.parseDicom(entries[paths[0]])
  expect(ds.string('x00100010')).toMatch(/^ANON-[0-9A-F]{8}$/)
  expect(ds.string('x00080020')).toMatch(/^\d{8}$/)
  expect(ds.string('x00080020')).not.toBe('20250101')
  expect(ds.string('x00080030')).toBe('120000')
  expect(ds.string('x00100040')).toBe('O')
  const everything = Buffer.concat(Object.values(entries)).toString('latin1')
  for (const original of ['Phantom', 'LUMEN-SAMPLE', '20250101', 'SAMPLE']) {
    expect(everything).not.toContain(original)
  }

  const zip = path.join(tempDir(), name)
  writeFileSync(zip, bytes)
  await openFiles(page, [zip])
  await expect(openButtons(page)).toHaveCount(2, SLOW)
  await openViewer(page, studyRow(page, /ANON-/))
  await expect(sliceCounter(page)).toHaveText('1 / 48')
})

test('opens an anonymised copy in Kontrast, which can be downloaded again', async ({ page }) => {
  await studyAction(page, studyRow(page, 'Sample'), 'Anonymise…')
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('radio', { name: 'Open in Kontrast' }).check()
  await dialog.getByRole('button', { name: 'Open copy' }).click()

  const copy = studyRow(page, /ANON-/)
  await expect(copy).toContainText('Anonymised copy', SLOW)
  await expect(copy).toContainText('No study description')
  await expect(studyRow(page, 'Phantom Lumen')).not.toContainText('copy')

  await studyAction(page, copy, 'Download zip')
  const { name, entries } = await savedZip(page)
  expect(name).toBe('anonymised-ct-study.zip')
  expect(Object.keys(entries)).toHaveLength(96)
})
