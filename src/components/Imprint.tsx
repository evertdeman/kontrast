import { useEffect, type ReactNode } from 'react'
import { SiteFooter } from '@/components/SiteFooter'
import { SiteHeader } from '@/components/SiteHeader'
import { IMPRINT, SITE } from '@/lib/site'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="flex flex-col gap-3 text-[15px] leading-relaxed text-muted-foreground [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4 [&_strong]:font-medium [&_strong]:text-foreground">
        {children}
      </div>
    </section>
  )
}

/** Provider identification required under § 5 DDG. */
export function Imprint() {
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  return (
    <div className="flex min-h-full flex-col bg-background text-foreground">
      <SiteHeader section="Imprint" home={{ href: '#' }} />

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-4 py-12 sm:px-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-[28px] font-semibold tracking-tight">Imprint</h1>
          <p className="text-[15px] text-muted-foreground">
            Information pursuant to § 5 DDG (Digitale-Dienste-Gesetz).
          </p>
        </div>

        <Section title="Provider">
          <address className="not-italic">
            <strong>{IMPRINT.name}</strong>
            <br />
            {IMPRINT.addressLines.map((line) => (
              <span key={line}>
                {line}
                <br />
              </span>
            ))}
          </address>
        </Section>

        <Section title="Contact">
          <p>
            Email: <a href={`mailto:${IMPRINT.email}`}>{IMPRINT.email}</a>
          </p>
        </Section>

        <Section title="Liability">
          <p>
            {SITE.name} is a non-commercial project provided free of charge and{' '}
            <strong>as is, without warranty</strong>. It is <strong>not a medical device</strong>{' '}
            and must not be used for diagnosis, treatment or any other medical decision.
          </p>
          <p>
            The source code is published on <a href={SITE.sourceUrl}>GitHub</a> under the terms of
            its <a href={SITE.licenseUrl}>licence</a>. Despite careful review, no liability is
            accepted for the completeness, accuracy or timeliness of the content. External links
            point to third-party sites whose content is the responsibility of their operators.
          </p>
        </Section>
      </main>

      <SiteFooter />
    </div>
  )
}
