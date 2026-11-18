import { test } from '@playwright/test'

/** A visible cursor, since recorded videos don't show the mouse pointer. */
function showCursor() {
  const dot = document.createElement('div')
  Object.assign(dot.style, {
    position: 'fixed',
    zIndex: '2147483647',
    width: '18px',
    height: '18px',
    marginLeft: '-9px',
    marginTop: '-9px',
    borderRadius: '50%',
    background: 'rgba(255, 255, 255, 0.85)',
    boxShadow: '0 0 0 2px rgba(0, 0, 0, 0.5)',
    pointerEvents: 'none',
    transition: 'transform 80ms',
    left: '-50px',
    top: '-50px',
  })
  const attach = () => document.body.appendChild(dot)
  if (document.body) attach()
  else document.addEventListener('DOMContentLoaded', attach)
  document.addEventListener('mousemove', (e) => {
    dot.style.left = `${e.clientX}px`
    dot.style.top = `${e.clientY}px`
  }, true)
  document.addEventListener('mousedown', () => (dot.style.transform = 'scale(0.7)'), true)
  document.addEventListener('mouseup', () => (dot.style.transform = ''), true)
}

test('README demo', async ({ page }) => {
  const pause = (ms: number) => page.waitForTimeout(ms)
  /** Glide the cursor to an element's centre, then click it. */
  const clickOn = async (locator: import('@playwright/test').Locator) => {
    const box = (await locator.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 20 })
    await pause(250)
    await locator.click()
  }

  await page.addInitScript(showCursor)
  await page.goto('./')
  await page.mouse.move(900, 650)
  await pause(1000)

  // Open the bundled sample study with one click.
  await clickOn(page.getByRole('button', { name: 'Open a sample study' }))
  await page.getByRole('button', { name: 'Open', exact: true }).waitFor()
  await pause(1400)

  // The study, with its series.
  await clickOn(page.getByRole('button', { name: 'MR', exact: true }))
  await pause(1400)

  // Scroll through the slices and try a window preset.
  await clickOn(page.getByRole('button', { name: 'Open', exact: true }))
  await page.locator('section[aria-label=Viewport] canvas').first().waitFor()
  await pause(1000)
  const view = (await page.locator('section[aria-label=Viewport]').boundingBox())!
  await page.mouse.move(view.x + view.width / 2, view.y + view.height / 2, { steps: 15 })
  for (let i = 0; i < 20; i++) {
    await page.mouse.wheel(0, 100)
    await pause(70)
  }
  await pause(600)
  // Switch to the second series (FLAIR) to show the two-series study, then back.
  const rail = page.getByRole('complementary', { name: 'Series' })
  await clickOn(rail.getByRole('button', { name: /FLAIR/ }))
  await pause(1300)
  await clickOn(rail.getByRole('button', { name: /T1/ }))
  await pause(1000)

  // Search the full header.
  await page.keyboard.press('h')
  await pause(700)
  await page.getByRole('dialog').getByRole('textbox').pressSequentially('patient', { delay: 90 })
  await pause(1400)
  await page.keyboard.press('Escape')
  await pause(600)

  // Anonymise the study and open the copy.
  await clickOn(page.getByRole('button', { name: 'Studies' }))
  await pause(900)
  await clickOn(page.getByRole('button', { name: 'Study actions' }))
  await pause(700)
  await clickOn(page.getByRole('menuitem', { name: 'Anonymise…' }))
  await pause(1600)
  await clickOn(page.getByRole('radio', { name: 'Open in Kontrast' }))
  await pause(400)
  await clickOn(page.getByRole('button', { name: 'Open copy' }))
  await page.getByText('Anonymised copy').waitFor()
  await pause(1200)

  // Edit a tag for testing, and open the edited copy too.
  const original = page.locator('main .grid').filter({ hasText: 'Kontrast Sample' }).filter({ has: page.getByTitle('Show study details') })
  await clickOn(original.getByRole('button', { name: 'Study actions' }))
  await pause(600)
  await clickOn(page.getByRole('menuitem', { name: 'Edit tags…' }))
  await pause(1200)
  const dialog = page.getByRole('dialog')
  await clickOn(dialog.getByLabel('Tag'))
  await dialog.getByLabel('Tag').pressSequentially('PatientName', { delay: 60 })
  await pause(500)
  await clickOn(dialog.getByLabel('New value'))
  await dialog.getByLabel('New value').pressSequentially('Test^Patient', { delay: 60 })
  await pause(900)
  await clickOn(dialog.getByRole('radio', { name: 'Open in Kontrast' }))
  await pause(400)
  await clickOn(dialog.getByRole('button', { name: 'Open copy' }))
  await page.getByText('Edited copy').waitFor()
  await page.mouse.move(640, 650, { steps: 15 })
  await pause(2500)

  await page.close()
  await page.video()!.saveAs('docs/demo.webm')
})
