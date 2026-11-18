/** Shared Playwright fixtures and helpers for driving Kontrast. */
import { test as base, expect, type Locator, type Page } from '@playwright/test'
import { unzipSync, type Unzipped } from 'fflate'

/** Known noise that isn't ours: next-themes' inline script warning under React 19. */
const IGNORED_ERRORS = [/Encountered a script tag/]

export const test = base.extend<{ consoleErrors: string[] }>({
  // Every test fails on console errors or uncaught exceptions in the page.
  consoleErrors: [
    async ({ page }, use, testInfo) => {
      const errors: string[] = []
      page.on('console', (m) => {
        if (m.type() === 'error' && !IGNORED_ERRORS.some((re) => re.test(m.text()))) {
          errors.push(m.text())
        }
      })
      page.on('pageerror', (e) => errors.push(e.message))
      await use(errors)
      // Only Chromium renders with the same WebGL setup as our users; Firefox runs downloads only.
      if (testInfo.project.name === 'chromium') expect(errors, 'console errors').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }

export const openButtons = (page: Page) => page.getByRole('button', { name: 'Open', exact: true })

/** For steps that rewrite or index a whole study, which takes a while with many tests in parallel. */
export const SLOW = { timeout: 60_000 }

export async function openSample(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open a sample study' }).click()
  await expect(openButtons(page)).toHaveCount(1, { timeout: 60_000 })
}

/** Open files from the landing page, or add them on the studies page. */
export async function openFiles(page: Page, paths: string[]) {
  if (page.url() === 'about:blank') await page.goto('/')
  await page.locator('input[type=file]:not([webkitdirectory])').first().setInputFiles(paths)
}

/** The row of the studies table that contains `text`. */
export function studyRow(page: Page, text: string | RegExp): Locator {
  return page
    .locator('main .grid')
    .filter({ has: page.getByTitle('Show study details') })
    .filter({ hasText: text })
}

export async function studyAction(page: Page, row: Locator, item: string | RegExp) {
  await row.getByRole('button', { name: 'Study actions' }).click()
  await page.getByRole('menuitem', { name: item }).click()
}

/**
 * Replace the browser's save dialog with one that keeps the bytes in the page,
 * so tests can read back what Kontrast saved. Call before navigating.
 */
export async function stubSavePicker(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>
    w.__saved = { name: '', chunks: [] as Uint8Array[], closed: false }
    w.showSaveFilePicker = async (opts: { suggestedName: string }) => {
      const saved = w.__saved as { name: string; chunks: Uint8Array[]; closed: boolean }
      saved.name = opts.suggestedName
      saved.chunks = []
      saved.closed = false
      return {
        createWritable: async () => ({
          write: async (chunk: Uint8Array) => void saved.chunks.push(new Uint8Array(chunk)),
          close: async () => void (saved.closed = true),
          abort: async () => {},
        }),
      }
    }
  })
}

/** The zip saved through the stubbed save dialog: its suggested name, bytes and entries. */
export async function savedZip(page: Page): Promise<{ name: string; bytes: Buffer; entries: Unzipped }> {
  await page.waitForFunction(() => (window as unknown as { __saved: { closed: boolean } }).__saved.closed, null, {
    timeout: 60_000,
  })
  const { name, base64 } = await page.evaluate(() => {
    const saved = (window as unknown as { __saved: { name: string; chunks: Uint8Array[] } }).__saved
    const all = new Uint8Array(saved.chunks.reduce((n, c) => n + c.length, 0))
    let offset = 0
    for (const chunk of saved.chunks) {
      all.set(chunk, offset)
      offset += chunk.length
    }
    let binary = ''
    for (let i = 0; i < all.length; i += 0x8000) binary += String.fromCharCode(...all.subarray(i, i + 0x8000))
    return { name: saved.name, base64: btoa(binary) }
  })
  const bytes = Buffer.from(base64, 'base64')
  return { name, bytes, entries: unzipSync(new Uint8Array(bytes)) }
}

/* Viewer */

export const viewport = (page: Page) => page.locator('section[aria-label=Viewport]')

/** The window/level readout, e.g. "W 400 L 40". */
export async function windowLevel(page: Page): Promise<string> {
  const text = await viewport(page).getByText(/^W -?\d+\s+L -?\d+$/).textContent()
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

/** The slice counter, e.g. "1 / 48". */
export const sliceCounter = (page: Page) => viewport(page).getByText(/^\d+ \/ \d+$/)

export async function openViewer(page: Page, row: Locator) {
  await row.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(viewport(page).locator('canvas').first()).toBeVisible()
  await expect(viewport(page).getByText(/^W -?\d+\s+L -?\d+$/)).toBeVisible()
}

/** Drag across the middle of the image with the left mouse button. */
export async function dragImage(page: Page, dx: number, dy: number) {
  const box = (await viewport(page).locator('canvas').first().boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y + dy, { steps: 10 })
  await page.mouse.up()
}

/** Whether a canvas has drawn something brighter than near-black. */
export async function canvasHasContent(canvas: Locator): Promise<boolean> {
  return canvas.evaluate((c: HTMLCanvasElement) => {
    const copy = document.createElement('canvas')
    copy.width = c.width
    copy.height = c.height
    const ctx = copy.getContext('2d')!
    ctx.drawImage(c, 0, 0)
    const px = ctx.getImageData(0, 0, copy.width, copy.height).data
    let lit = 0
    for (let i = 0; i < px.length; i += 4) if (px[i] > 30) lit++
    return lit > 500
  })
}
