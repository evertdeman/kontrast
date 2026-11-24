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
  await expect(viewport(page).locator('canvas').first()).toBeVisible()
  await expect.poll(() => canvasHasContent(viewport(page).locator('canvas').first())).toBe(true)
  // A volume opens on its middle slice, not the near-empty first one.
  await expect(sliceCounter(page)).toHaveText(/^[2-7] \/ 8$/)
  // The overlay shows the volume name and format, not empty DICOM placeholders.
  await expect(viewport(page).getByText('NIfTI')).toBeVisible()
  await expect(viewport(page).getByText('brain', { exact: true })).toBeVisible()
  await expect(viewport(page).getByText('ANONYMOUS')).toHaveCount(0)
  // The volume carries its own window/level; we only assert a readout is shown.
  await expect.poll(() => windowLevel(page)).toMatch(/^W \d+ L -?\d+$/)
  // NIfTI voxels are normalised for display, so the readout is flagged as
  // uncalibrated and the intensity ROI tool is not offered (its mean/SD would
  // be meaningless). Spatial measurements (length, angle) stay available.
  await expect(viewport(page).getByText('uncalibrated')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Elliptical region' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Length measurement' })).toBeVisible()

  const startSlice = Number((await sliceCounter(page).textContent())!.split('/')[0])
  await page.keyboard.press('ArrowDown')
  await expect(sliceCounter(page)).toHaveText(`${startSlice + 1} / 8`)

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
