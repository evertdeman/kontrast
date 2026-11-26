export const SITE = {
  name: 'Kontrast',
  sourceUrl: 'https://github.com/evertdeman/kontrast',
  licenseUrl: 'https://github.com/evertdeman/kontrast/blob/main/LICENSE',
} as const

/** Static pages, hash routes so they work on GitHub Pages without a server fallback. */
export const PRIVACY_HASH = '#privacy'
export const IMPRINT_HASH = '#imprint'

/** Provider details shown in the imprint (§ 5 DDG). */
export const IMPRINT = {
  name: 'Evert de Man',
  addressLines: ['Möckernstraße 16-18', '10963 Berlin', 'Germany'],
  email: 'memos34_retread@icloud.com',
} as const

export const FOOTER_LINKS = [
  { label: 'Privacy', href: PRIVACY_HASH },
  { label: 'Imprint', href: IMPRINT_HASH },
  { label: 'Licence', href: SITE.licenseUrl },
  { label: 'Source code', href: SITE.sourceUrl },
] as const
