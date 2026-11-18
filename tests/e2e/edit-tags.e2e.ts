import type { Locator, Page } from '@playwright/test'
import dicomParser from 'dicom-parser'
import {
  expect,
  openButtons,
  openSample,
  SLOW,
  savedZip,
  studyAction,
  studyRow,
  stubSavePicker,
  test,
} from './fixtures'

const dialog = (page: Page) => page.getByRole('dialog')
/** The change lines: the boxes with a Tag field. */
const changes = (page: Page) => dialog(page).locator('fieldset > div').filter({ has: page.getByLabel('Tag') })
const saveButton = (page: Page) => dialog(page).getByRole('button', { name: /Save zip|Open copy/ })

async function addChange(page: Page, tag: string, value: string, options: { action?: string; series?: string } = {}) {
  if ((await changes(page).last().getByLabel('Tag').inputValue()) !== '') {
    await dialog(page).getByRole('button', { name: 'Add change' }).click()
  }
  const change: Locator = changes(page).last()
  await change.getByLabel('Tag').fill(tag)
  if (options.action) await change.getByLabel('Action').selectOption({ label: options.action })
  if (value) await change.getByLabel('New value').fill(value)
  if (options.series) await change.getByLabel('Series').selectOption({ label: options.series })
  return change
}

test.beforeEach(async ({ page }) => {
  await stubSavePicker(page)
  await openSample(page)
})

test('the row menu lists the study actions', async ({ page }) => {
  await studyRow(page, 'Sample').getByRole('button', { name: 'Study actions' }).click()
  await expect(page.getByRole('menuitem')).toHaveText([
    'Details',
    'Anonymise…',
    'Edit tags…',
    'Remove from session',
  ])
})

test('edits tags and saves the copies as a zip', async ({ page }) => {
  await studyAction(page, studyRow(page, 'Sample'), 'Edit tags…')
  await expect(dialog(page)).toContainText('For testing only')

  const name = await addChange(page, 'PatientName', 'Test^Patient')
  await expect(name).toContainText('now: Phantom^Lumen')

  const date = await addChange(page, '(0008,0020)', '2024-13-99')
  await expect(date).toContainText('isn’t a date as YYYYMMDD')
  await expect(saveButton(page)).toBeEnabled()

  const rows = await addChange(page, 'Rows', 'abc')
  await expect(rows).toContainText('doesn’t fit a US')
  await expect(saveButton(page)).toBeDisabled()
  await rows.getByRole('button', { name: 'Remove change' }).click()
  await expect(saveButton(page)).toBeEnabled()

  await addChange(page, 'SeriesDescription', 'Edited coronal', { series: '#2 Coronal' })
  await addChange(page, 'PatientID', '', { action: 'Remove' })
  await saveButton(page).click()

  const { name: fileName, entries } = await savedZip(page)
  expect(fileName).toBe('edited-ct-study.zip')
  const paths = Object.keys(entries).sort()
  expect(paths).toHaveLength(96)
  expect(paths[0]).toBe('01 Axial/IM0000.dcm')

  const axial = dicomParser.parseDicom(entries[paths[0]])
  const coronal = dicomParser.parseDicom(entries[paths.find((p) => p.startsWith('02 '))!])
  expect(axial.string('x00100010')).toBe('Test^Patient')
  expect(axial.string('x00080020')).toBe('2024-13-99')
  expect(axial.elements.x00100020).toBeUndefined()
  expect(axial.string('x0008103e')).toBe('Axial')
  expect(coronal.string('x0008103e')).toBe('Edited coronal')
  expect(axial.string('x0020000d')).toMatch(/^2\.25\./)
  expect(coronal.string('x0020000d')).toBe(axial.string('x0020000d'))
})

test('opens an edited copy in Kontrast, marked and downloadable', async ({ page }) => {
  const original = studyRow(page, 'Phantom Lumen')
  await studyAction(page, original, 'Edit tags…')
  await addChange(page, 'PatientName', 'Copy^Patient')

  const newUids = dialog(page).getByRole('checkbox', { name: /new UIDs/ })
  const openInKontrast = dialog(page).getByRole('radio', { name: 'Open in Kontrast' })
  await newUids.uncheck()
  await expect(openInKontrast).toBeDisabled()
  await newUids.check()
  await openInKontrast.check()
  await saveButton(page).click()

  await expect(openButtons(page)).toHaveCount(2, SLOW)
  const copy = studyRow(page, 'Copy Patient')
  await expect(copy).toContainText('Edited copy')
  await expect(original).not.toContainText('copy')

  await original.getByRole('button', { name: 'Study actions' }).click()
  await expect(page.getByRole('menuitem', { name: 'Download zip' })).toHaveCount(0)
  await page.keyboard.press('Escape')

  await studyAction(page, copy, 'Download zip')
  const { name, entries } = await savedZip(page)
  expect(name).toBe('edited-ct-study.zip')
  const first = Object.keys(entries).sort()[0]
  expect(dicomParser.parseDicom(entries[first]).string('x00100010')).toBe('Copy^Patient')

  await studyAction(page, copy, 'Remove from session')
  await expect(dialog(page)).toContainText('exists only here')
})

test('reopening the editor for the same study keeps the changes', async ({ page }) => {
  const row = studyRow(page, 'Sample')
  await studyAction(page, row, 'Edit tags…')
  await addChange(page, 'PatientName', 'Kept^Patient')
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toHaveCount(0)

  await studyAction(page, row, 'Edit tags…')
  await expect(changes(page).first().getByLabel('Tag')).toHaveValue('PatientName')
  await expect(changes(page).first().getByLabel('New value')).toHaveValue('Kept^Patient')
})
