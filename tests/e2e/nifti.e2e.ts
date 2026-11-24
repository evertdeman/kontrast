import {
  canvasHasContent,
  expect,
  openFiles,
  openViewer,
  sliceCounter,
  studyRow,
  test,
  viewport,
  windowLevel,
} from './fixtures'
import { niftiFile, niftiGzFile, tempDir } from './data'

test('opens a .nii volume, renders it and scrolls its slices', async ({ page }) => {
  await openFiles(page, [niftiFile(tempDir())])
  const row = studyRow(page, 'brain')
  await expect(row).toHaveCount(1)

  await openViewer(page, row)
  await expect.poll(() => canvasHasContent(viewport(page).locator('canvas').first())).toBe(true)
  await expect(sliceCounter(page)).toHaveText('1 / 8')
  // Windowed to the header's display range (cal_min 0, cal_max 1000); DICOM's
  // linear window function reads that back as a width of 999.
  await expect.poll(() => windowLevel(page)).toBe('W 999 L 500')

  await page.keyboard.press('ArrowDown')
  await expect(sliceCounter(page)).toHaveText('2 / 8')

  // NIfTI has no DICOM header, so the full-header view is hidden.
  await expect(page.getByRole('button', { name: /View full header/ })).toHaveCount(0)
})

test('opens a gzip-compressed .nii.gz volume', async ({ page }) => {
  await openFiles(page, [niftiGzFile(tempDir())])
  const row = studyRow(page, 'brain')
  await expect(row).toHaveCount(1)

  await openViewer(page, row)
  await expect.poll(() => canvasHasContent(viewport(page).locator('canvas').first())).toBe(true)
})

test('a NIfTI study offers no anonymise or edit actions (view-only)', async ({ page }) => {
  await openFiles(page, [niftiFile(tempDir())])
  const row = studyRow(page, 'brain')
  await row.getByRole('button', { name: 'Study actions' }).click()

  await expect(page.getByRole('menuitem', { name: 'Details' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: /Anonymise/ })).toHaveCount(0)
  await expect(page.getByRole('menuitem', { name: /Edit tags/ })).toHaveCount(0)
})
