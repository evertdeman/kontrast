import { useEffect, type ReactNode } from 'react'
import { SiteFooter } from '@/components/SiteFooter'
import { SiteHeader } from '@/components/SiteHeader'
import { SITE } from '@/lib/site'

const LAST_UPDATED = '18 November 2026'
const GITHUB_PRIVACY_URL =
  'https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="flex flex-col gap-3 text-[15px] leading-relaxed text-muted-foreground [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4 [&_code]:font-mono [&_code]:text-[13px] [&_code]:text-foreground [&_strong]:font-medium [&_strong]:text-foreground [&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-1.5 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  )
}

/** What Kontrast stores and sends. Keep in step with the privacy end-to-end test. */
export function Privacy() {
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  return (
    <div className="flex min-h-full flex-col bg-background text-foreground">
      <SiteHeader section="Privacy" home={{ href: '#' }} />

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-4 py-12 sm:px-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-[28px] font-semibold tracking-tight">Privacy</h1>
          <p className="text-[15px] text-muted-foreground">Last updated {LAST_UPDATED}</p>
        </div>

        <p className="text-[17px] leading-relaxed">
          {SITE.name} runs entirely in your browser. Your DICOM files are never uploaded.
        </p>

        <Section title="Your files">
          <ul>
            <li>
              When you open files, {SITE.name} reads them into this browser tab’s memory. They are
              not sent anywhere.
            </li>
            <li>They stay there until you clear the session, or close or reload the tab.</li>
            <li>
              Anonymised or edited copies you make are also kept only in the tab until you save
              them. Saved files go where you choose.
            </li>
          </ul>
        </Section>

        <Section title="What your browser stores">
          <p>Four entries, in your browser’s local storage on your own device:</p>
          <ul>
            <li>
              <code>theme</code>: whether you chose the light or dark theme.
            </li>
            <li>
              <code>kontrast.inspector</code>: the width of the header panel in the viewer, and
              whether it is hidden.
            </li>
            <li>
              <code>cornerstone3D.renderingCapabilities</code>: set by Cornerstone, the library
              that draws the images. It records the name of your graphics card and which image
              formats it supports, so this doesn’t have to be tested on every visit.
            </li>
            <li>
              <code>loglevel</code>: set by a library Cornerstone uses. It records how much detail
              to write to the browser’s developer console, such as <code>WARN</code>.
            </li>
          </ul>
          <p>
            {SITE.name} sets <strong>no cookies</strong> of its own and uses{' '}
            <strong>no analytics or tracking</strong>. One exception: if your browser blocks local
            storage, <code>loglevel</code> keeps its setting in a session cookie instead, which your
            browser also sends to GitHub Pages with each request. It contains only that setting.
          </p>
          <p>
            Like any website, your browser may also cache the app’s own files so it loads faster.
            Clearing this site’s data in your browser removes all of it.
          </p>
        </Section>

        <Section title="What is sent over the network">
          <ul>
            <li>The app itself, loaded from GitHub Pages.</li>
            <li>
              The sample study, only if you open it. It is a simulated brain MRI built from an
              averaged anatomical template, not a real patient.
            </li>
          </ul>
          <p>
            Nothing else. Fonts are part of the app, and no other services are contacted. The
            links to the source code and licence take you to GitHub.
          </p>
          <p>
            Your browser enforces this: the app comes with a Content Security Policy that blocks it
            from connecting to any server other than the one it was loaded from. Links you choose
            to follow still work as normal.
          </p>
        </Section>

        <Section title="Hosting">
          <p>
            {SITE.name} is hosted on GitHub Pages. GitHub may record technical details of visits,
            such as your IP address and browser, as described in the{' '}
            <a href={GITHUB_PRIVACY_URL}>GitHub Privacy Statement</a>. The developer of {SITE.name}{' '}
            does not receive these records.
          </p>
        </Section>

        <Section title="Questions">
          <p>
            Open an issue on <a href={`${SITE.sourceUrl}/issues`}>GitHub</a>.
          </p>
        </Section>
      </main>

      <SiteFooter />
    </div>
  )
}
