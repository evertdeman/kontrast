import { readFileSync } from 'node:fs'
import { unzipSync } from 'fflate'
import { expect, openSample, studyAction, studyRow, test } from './fixtures'

// Browsers without a save dialog (Firefox, Safari) get a plain download instead.
test('saves through a plain download when there is no save dialog', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker
  })
  await openSample(page)
  await studyAction(page, studyRow(page, 'Sample'), 'Anonymise…')

  const download = page.waitForEvent('download')
  await page.getByRole('dialog').getByRole('button', { name: 'Save zip' }).click()
  const file = await download

  expect(file.suggestedFilename()).toBe('anonymised-ct-study.zip')
  const entries = unzipSync(new Uint8Array(readFileSync(await file.path())))
  expect(Object.keys(entries)).toHaveLength(96)
})
