import { largeCtZip, tempDir } from './data'
import {
  canvasHasContent,
  expect,
  openButtons,
  openFiles,
  openViewer,
  sliceCounter,
  studyRow,
  test,
  viewport,
} from './fixtures'

// Each slice is over 512 KB, which used to start a Web Worker per entry and crash the page.
test('opens a large zip of uncompressed slices', async ({ page }) => {
  test.setTimeout(120_000)
  const zip = largeCtZip(tempDir(), 300)

  await openFiles(page, [zip])
  await expect(page.getByText(/Unpacking zip archives|Indexing DICOM headers/)).toBeVisible()
  await expect(openButtons(page)).toHaveCount(1, { timeout: 90_000 })

  await openViewer(page, studyRow(page, 'Large zip'))
  await expect(sliceCounter(page)).toHaveText('1 / 300')
  await expect.poll(() => canvasHasContent(viewport(page).locator('canvas').first())).toBe(true)
})
