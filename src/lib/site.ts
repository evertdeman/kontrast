// TODO: point these at the public repository once it has its final name.
export const SITE = {
  name: 'Kontrast',
  sourceUrl: 'https://github.com/your-name/kontrast',
  licenseUrl: 'https://github.com/your-name/kontrast/blob/main/LICENSE',
} as const

export const FOOTER_LINKS = [
  { label: 'Licence', href: SITE.licenseUrl },
  { label: 'Source code', href: SITE.sourceUrl },
] as const
