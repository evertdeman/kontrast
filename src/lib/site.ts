export const SITE = {
  name: 'Kontrast',
  sourceUrl: 'https://github.com/evertdeman/kontrast',
  licenseUrl: 'https://github.com/evertdeman/kontrast/blob/main/LICENSE',
} as const

/** The privacy page, a hash route so it works on GitHub Pages without a server fallback. */
export const PRIVACY_HASH = '#privacy'

export const FOOTER_LINKS = [
  { label: 'Privacy', href: PRIVACY_HASH },
  { label: 'Licence', href: SITE.licenseUrl },
  { label: 'Source code', href: SITE.sourceUrl },
] as const
