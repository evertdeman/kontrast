import { expect, openSample, openViewer, studyRow, test } from './fixtures'

test('the privacy page is linked from the footer and leads back home', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('navigation', { name: 'Project' }).getByRole('link', { name: 'Privacy' }).click()
  await expect(page.getByRole('heading', { name: 'Privacy', level: 1 })).toBeVisible()
  await expect(page.getByRole('main')).toContainText('kontrast.inspector')

  await page.getByRole('link', { name: /home$/ }).click()
  await expect(page.getByRole('button', { name: 'Open a sample study' })).toBeVisible()
})

test('the privacy page has its own address', async ({ page }) => {
  await page.goto('./#privacy')
  await expect(page.getByRole('heading', { name: 'Privacy', level: 1 })).toBeVisible()
})

test('opening the privacy page during a session keeps the session', async ({ page, context }) => {
  await openSample(page)
  const popup = context.waitForEvent('page')
  await page.getByRole('navigation', { name: 'Project' }).getByRole('link', { name: 'Privacy' }).click()
  const privacy = await popup
  await expect(privacy.getByRole('heading', { name: 'Privacy', level: 1 })).toBeVisible()
  await expect(studyRow(page, 'Sample')).toBeVisible()
})

// Keeps the privacy page true: what it lists must be all the app stores and contacts.
test('the app stores and contacts only what the privacy page lists', async ({ page, context, baseURL }) => {
  const origins = new Set<string>()
  page.on('request', (request) => origins.add(new URL(request.url()).origin))

  await openSample(page)
  await page.getByRole('button', { name: 'Toggle theme' }).click()
  await openViewer(page, studyRow(page, 'Sample'))
  await page.keyboard.press('t')
  await page.keyboard.press('t')

  const appOrigin = new URL(baseURL!).origin
  expect([...origins].filter((o) => o !== appOrigin && !o.startsWith('data:') && !o.startsWith('blob:'))).toEqual([])
  expect(await context.cookies()).toEqual([])
  const keys = await page.evaluate(() => Object.keys(localStorage).sort())
  expect(keys).toEqual(['cornerstone3D.renderingCapabilities', 'kontrast.inspector', 'loglevel', 'theme'])
  const otherStorage = await page.evaluate(async () => ({
    sessionStorage: Object.keys(sessionStorage),
    indexedDB: (await indexedDB.databases()).map((db) => db.name),
    cacheStorage: await caches.keys(),
  }))
  expect(otherStorage).toEqual({ sessionStorage: [], indexedDB: [], cacheStorage: [] })
})

test('the browser blocks the app from connecting to any other server', async ({ page, consoleErrors }) => {
  await page.goto('./')
  const result = await page.evaluate(async () => {
    const violation = new Promise<string>((resolve) =>
      document.addEventListener('securitypolicyviolation', (e) => resolve(e.effectiveDirective), { once: true }),
    )
    const outcome = await fetch('https://example.com/upload', { method: 'POST', body: 'data' }).then(
      () => 'sent',
      () => 'blocked',
    )
    return { outcome, directive: await violation }
  })
  expect(result).toEqual({ outcome: 'blocked', directive: 'connect-src' })
  // The browser reports the blocked request in the console; that one is expected.
  consoleErrors.splice(0, consoleErrors.length, ...consoleErrors.filter((e) => !/Content Security Policy|Failed to fetch/.test(e)))
})
