import {
  canvasHasContent,
  dragImage,
  expect,
  openSample,
  openViewer,
  sliceCounter,
  studyRow,
  test,
  viewport,
  windowLevel,
} from './fixtures'

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
    await rail.getByRole('button', { name: /Coronal/ }).click()
    await rail.getByRole('button', { name: /Axial/ }).click()
  }
  await expect(sliceCounter(page)).toHaveText('1 / 48')
})

test('CT presets apply by key and from the menu, and stay while scrolling', async ({ page }) => {
  await page.keyboard.press('2')
  await expect.poll(() => windowLevel(page)).toBe('W 1500 L -600')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect(sliceCounter(page)).toHaveText('3 / 48')
  await expect.poll(() => windowLevel(page)).toBe('W 1500 L -600')

  await page.getByRole('button', { name: 'Presets' }).click()
  await page.getByRole('menuitem', { name: /Brain/ }).click()
  await expect.poll(() => windowLevel(page)).toBe('W 80 L 40')
})

test('the elliptical region shows Hounsfield statistics', async ({ page }) => {
  await page.keyboard.press('a')
  await expect(tool(page, 'Angle measurement')).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('e')
  await expect(tool(page, 'Elliptical region')).toHaveAttribute('aria-pressed', 'true')

  await page.keyboard.press('4')
  await dragImage(page, 60, 40)
  const annotation = viewport(page).locator('svg text')
  await expect(annotation.filter({ hasText: /Mean: .* HU/ })).toHaveCount(1)
})
