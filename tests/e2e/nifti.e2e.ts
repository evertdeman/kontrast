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
  // Rendered as a volume: 8 slices, opening on the middle one.
  await expect(sliceCounter(page).first()).toHaveText(/^\d+ \/ 8$/)
  // Windowed to the volume's range (disk 1000 on 0 background), not blown out.
  await expect
    .poll(async () => {
      const m = /^W (\d+) L (\d+)$/.exec(await windowLevel(page))
      if (!m) return false
      const [, ww, wl] = m.map(Number)
      return ww >= 900 && ww <= 1000 && wl >= 400 && wl <= 600
    })
    .toBe(true)

  // Scrolling moves through the slices.
  const before = Number(/^(\d+)/.exec((await sliceCounter(page).first().textContent()) ?? '')![1])
  await page.keyboard.press('ArrowDown')
  await expect.poll(async () =>
    Number(/^(\d+)/.exec((await sliceCounter(page).first().textContent()) ?? '')![1]),
  ).toBe(before + 1)

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
