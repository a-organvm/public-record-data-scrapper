const COMPANY_SUFFIXES = [
  'incorporated',
  'inc',
  'corp',
  'corporation',
  'llc',
  'l.l.c',
  'ltd',
  'limited',
  'lp',
  'l.p',
  'llp',
  'l.l.p',
  'pllc',
  'co',
  'company'
]

export function normalizeCompanyName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !COMPANY_SUFFIXES.includes(token))
    .join(' ')
}
