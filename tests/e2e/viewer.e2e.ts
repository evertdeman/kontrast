import {
  canvasHasContent,
  dragImage,
  expect,
  openFiles,
  openSample,
  openViewer,
  sliceCounter,
  studyRow,
  test,
  viewport,
  windowLevel,
} from './fixtures'
import { ctHeadZip, tempDir } from './data'

/** From the viewer, go back to the studies list, add a CT head and open it. */
async function openCtHead(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Studies' }).click()
  await openFiles(page, [ctHeadZip(tempDir())])
  await openViewer(page, studyRow(page, 'Phantom CT'))
}

const tool = (page: import('@playwright/test').Page, name: string) =>
  page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name, exact: true })

test.beforeEach(async ({ page }) => {
  await openSample(page)
  await openViewer(page, studyRow(page, 'Sample'))
})

test('draws the image and keeps the window/level readout live while dragging', async ({ page }) => {
  await expect.poll(() => canvasHasContent(viewport(page).locator('canvas').first())).toBe(true)
  const before = await windowLevel(page)
  await dragImage(page, 120, 60)
  await expect.poll(() => windowLevel(page)).not.toBe(before)
})

test('the left mouse button follows the toolbar after reopening the viewer', async ({ page }) => {
  await page.keyboard.press('l')
  await expect(tool(page, 'Length measurement')).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: 'Studies' }).click()
  await openViewer(page, studyRow(page, 'Sample'))
  await expect(tool(page, 'Window / Level')).toHaveAttribute('aria-pressed', 'true')
  await expect(tool(page, 'Length measurement')).toHaveAttribute('aria-pressed', 'false')

  const before = await windowLevel(page)
  await dragImage(page, -100, -80)
  await expect.poll(() => windowLevel(page)).not.toBe(before)
})

test('rapid series switching ends on the first slice of the chosen series', async ({ page }) => {
  const rail = page.getByRole('complementary', { name: 'Series' })
  for (let i = 0; i < 3; i++) {
    await rail.getByRole('button', { name: /FLAIR/ }).click()
    await rail.getByRole('button', { name: /T1/ }).click()
  }
  await expect(sliceCounter(page)).toHaveText('1 / 39')
})

test('CT presets apply by key and from the menu, and stay while scrolling', async ({ page }) => {
  await openCtHead(page)

  await page.keyboard.press('2')
  await expect.poll(() => windowLevel(page)).toBe('W 1500 L -600')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect(sliceCounter(page)).toHaveText('3 / 6')
  await expect.poll(() => windowLevel(page)).toBe('W 1500 L -600')

  await page.getByRole('button', { name: 'Presets' }).click()
  await page.getByRole('menuitem', { name: /Brain/ }).click()
  await expect.poll(() => windowLevel(page)).toBe('W 80 L 40')
})

test('the elliptical region shows Hounsfield statistics', async ({ page }) => {
  await openCtHead(page)

  await page.keyboard.press('a')
  await expect(tool(page, 'Angle measurement')).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('e')
  await expect(tool(page, 'Elliptical region')).toHaveAttribute('aria-pressed', 'true')

  await page.keyboard.press('4')
  await dragImage(page, 60, 40)
  const annotation = viewport(page).locator('svg text')
  await expect(annotation.filter({ hasText: /Mean: .* HU/ })).toHaveCount(1)
})

test('every toolbar button shows a tooltip with its shortcut', async ({ page }) => {
  const toolbar = page.getByRole('toolbar', { name: 'Tools' })
  const buttons = await toolbar.getByRole('button').all()
  expect(buttons.length).toBeGreaterThanOrEqual(12)
  for (const button of buttons) {
    const name = (await button.getAttribute('aria-label')) ?? (await button.innerText())
    await button.hover()
    const tooltip = page.getByRole('tooltip')
    await expect(tooltip, name).toBeVisible()
    await expect(tooltip.locator('kbd'), name).toHaveCount(1)
    // Move away like a real pointer, through the space below the toolbar.
    const box = (await button.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + 150, { steps: 5 })
    await expect(tooltip, `${name} closes`).toHaveCount(0)
  }
})

test('C saves a screenshot', async ({ page }) => {
  const download = page.waitForEvent('download')
  await page.keyboard.press('c')
  expect((await download).suggestedFilename()).toMatch(/^kontrast-MR-\d+\.png$/)
})

test('the header panel keeps UIDs on one line with a copy button, and text in the sans font', async ({ page }) => {
  const panel = page.getByRole('complementary', { name: 'Inspector' })
  const uid = panel.locator('dd').filter({ has: page.getByRole('button', { name: 'Copy Study UID' }) })
  await expect(uid).toHaveCount(1)
  const uidText = uid.locator('span').first()
  const lineHeight = await uidText.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight))
  expect((await uidText.boundingBox())!.height).toBeLessThanOrEqual(lineHeight + 1)

  const description = panel.locator('dd', { hasText: 'simulated brain MRI' })
  const font = await description.evaluate((el) => getComputedStyle(el).fontFamily)
  expect(font).not.toMatch(/mono/i)
  expect(await description.innerText()).not.toMatch(/he\s+ad/)
})
