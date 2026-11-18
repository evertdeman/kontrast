import { SAMPLE_ZIP, longValuesFile, tempDir } from './data'
import {
  canvasHasContent,
  expect,
  openButtons,
  openFiles,
  openSample,
  studyAction,
  studyRow,
  test,
} from './fixtures'

const dialog = (page: import('@playwright/test').Page) => page.getByRole('dialog')

test.describe('with the sample open', () => {
  test.beforeEach(async ({ page }) => openSample(page))

  test('shows a thumbnail for each series', async ({ page }) => {
    await studyRow(page, 'Sample').getByRole('button', { name: 'CT', exact: true }).click()
    const thumbnails = page.locator('main canvas')
    await expect(thumbnails).toHaveCount(2)
    for (const canvas of await thumbnails.all()) {
      await expect.poll(() => canvasHasContent(canvas)).toBe(true)
    }
  })

  test('adding the same files again keeps one study', async ({ page }) => {
    await openFiles(page, [SAMPLE_ZIP])
    await expect(page.getByText('Those images are already open.')).toBeVisible()
    await expect(openButtons(page)).toHaveCount(1)
  })

  test('shows study details', async ({ page }) => {
    await page.getByTitle('Show study details').click()
    await expect(dialog(page)).toContainText('2025-01-01 · MR · 2 series · 78 images')
    await expect(dialog(page)).toContainText('Kontrast Sample')
    await expect(dialog(page)).toContainText(/Age\s*Unknown/)
    await expect(dialog(page).getByRole('row', { name: /Axial T1.*39.*152 mm/ })).toBeVisible()
    await expect(dialog(page).getByRole('button', { name: 'Copy Study UID' })).toBeVisible()
  })

  test('removing a study asks first, and it can be added again', async ({ page }) => {
    const row = studyRow(page, 'Sample')
    await studyAction(page, row, 'Remove from session')
    await expect(dialog(page)).toContainText('Remove this study?')
    await dialog(page).getByRole('button', { name: 'Cancel' }).click()
    await expect(openButtons(page)).toHaveCount(1)

    await studyAction(page, row, 'Remove from session')
    await dialog(page).getByRole('button', { name: 'Remove' }).click()
    await expect(page.getByText('No studies loaded')).toBeVisible()

    await openFiles(page, [SAMPLE_ZIP])
    await expect(openButtons(page)).toHaveCount(1)
  })

  test('clearing asks first, from the logo and from Clear all', async ({ page }) => {
    await page.getByRole('button', { name: /home$/ }).click()
    await expect(dialog(page)).toContainText('Clear all studies?')
    await dialog(page).getByRole('button', { name: 'Cancel' }).click()
    await expect(openButtons(page)).toHaveCount(1)

    await page.getByRole('main').getByRole('button', { name: 'Clear all' }).click()
    await dialog(page).getByRole('button', { name: 'Clear all' }).click()
    await expect(page.getByRole('button', { name: 'Open a sample study' })).toBeVisible()
  })

  test('leaving the page asks first only while studies are open', async ({ page }) => {
    const leavingIsBlocked = () =>
      page.evaluate(() => {
        const event = new Event('beforeunload', { cancelable: true })
        window.dispatchEvent(event)
        return event.defaultPrevented
      })
    expect(await leavingIsBlocked()).toBe(true)

    await page.getByRole('main').getByRole('button', { name: 'Clear all' }).click()
    await dialog(page).getByRole('button', { name: 'Clear all' }).click()
    await expect(page.getByRole('button', { name: 'Open a sample study' })).toBeVisible()
    expect(await leavingIsBlocked()).toBe(false)
  })
})

test('long values wrap within their column, and UTF-8 names display correctly', async ({ page }) => {
  await openFiles(page, [longValuesFile(tempDir())])
  await expect(page.getByText('Verylongfamilynamewithoutanyspaces Jürgen')).toBeVisible()

  await page.getByTitle('Show study details').click()
  await expect(dialog(page)).toContainText('Universitätsklinikum')
  await expect(dialog(page)).not.toContainText('Ã')

  const overflowing = await dialog(page).evaluate((d) => {
    const out: string[] = []
    for (const cell of d.querySelectorAll('dl > div')) {
      const box = cell.getBoundingClientRect()
      for (const el of cell.querySelectorAll('dd > *')) {
        const r = el.getBoundingClientRect()
        if (r.right > box.right + 1 || r.left < box.left - 1) out.push(cell.querySelector('dt')!.textContent!)
      }
    }
    if (d.scrollWidth > d.clientWidth + 1) out.push('dialog scrolls sideways')
    return out
  })
  expect(overflowing).toEqual([])
})
