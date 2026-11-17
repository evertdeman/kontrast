export const SITE = {
  name: 'Kontrast',
  sourceUrl: 'https://github.com/evertdeman/kontrast',
  licenseUrl: 'https://github.com/evertdeman/kontrast/blob/main/LICENSE',
} as const

export const FOOTER_LINKS = [
  { label: 'Licence', href: SITE.licenseUrl },
  { label: 'Source code', href: SITE.sourceUrl },
] as const
