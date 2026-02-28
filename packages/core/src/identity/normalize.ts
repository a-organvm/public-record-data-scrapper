/**
 * Entity Normalization Module
 *
 * Provides functions to normalize company names, addresses, and other
 * entity data for matching and deduplication purposes.
 */

// Common legal suffixes to strip
const LEGAL_SUFFIXES = [
  // Standard US suffixes
  'llc',
  'l.l.c.',
  'l.l.c',
  'inc',
  'inc.',
  'incorporated',
  'corp',
  'corp.',
  'corporation',
  'ltd',
  'ltd.',
  'limited',
  'lp',
  'l.p.',
  'l.p',
  'llp',
  'l.l.p.',
  'l.l.p',
  'pllc',
  'p.l.l.c.',
  'p.l.l.c',
  'plc',
  'p.l.c.',
  'p.l.c',
  'pc',
  'p.c.',
  'p.c',
  'co',
  'co.',
  'company',
  'pa',
  'p.a.',
  'professional association',
  'np',
  'n.p.',
  'nonprofit',
  // International
  'gmbh',
  'ag',
  'sa',
  'bv',
  'nv',
  'pty',
  'oy',
  'ab'
]

// Common DBA indicators
const DBA_INDICATORS = [
  'd/b/a',
  'dba',
  'd.b.a.',
  'doing business as',
  't/a',
  'ta',
  't.a.',
  'trading as',
  'a/k/a',
  'aka',
  'a.k.a.',
  'also known as',
  'f/k/a',
  'fka',
  'f.k.a.',
  'formerly known as'
]

// State name to abbreviation mapping
const STATE_ABBREVIATIONS: Record<string, string> = {
  alabama: 'AL',
  alaska: 'AK',
  arizona: 'AZ',
  arkansas: 'AR',
  california: 'CA',
  colorado: 'CO',
  connecticut: 'CT',
  delaware: 'DE',
  florida: 'FL',
  georgia: 'GA',
  hawaii: 'HI',
  idaho: 'ID',
  illinois: 'IL',
  indiana: 'IN',
  iowa: 'IA',
  kansas: 'KS',
  kentucky: 'KY',
  louisiana: 'LA',
  maine: 'ME',
  maryland: 'MD',
  massachusetts: 'MA',
  michigan: 'MI',
  minnesota: 'MN',
  mississippi: 'MS',
  missouri: 'MO',
  montana: 'MT',
  nebraska: 'NE',
  nevada: 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  ohio: 'OH',
  oklahoma: 'OK',
  oregon: 'OR',
  pennsylvania: 'PA',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  tennessee: 'TN',
  texas: 'TX',
  utah: 'UT',
  vermont: 'VT',
  virginia: 'VA',
  washington: 'WA',
  'west virginia': 'WV',
  wisconsin: 'WI',
  wyoming: 'WY',
  'district of columbia': 'DC',
  'puerto rico': 'PR',
  guam: 'GU',
  'virgin islands': 'VI'
}

// Common abbreviations to expand
const ABBREVIATIONS: Record<string, string> = {
  intl: 'international',
  natl: 'national',
  svcs: 'services',
  svc: 'service',
  mgmt: 'management',
  mgt: 'management',
  assoc: 'associates',
  bros: 'brothers',
  ent: 'enterprises',
  grp: 'group',
  hldgs: 'holdings',
  inds: 'industries',
  ind: 'industries',
  mfg: 'manufacturing',
  prop: 'properties',
  sys: 'systems',
  tech: 'technology',
  telecom: 'telecommunications',
  transp: 'transportation',
  univ: 'university',
  ctr: 'center',
  dept: 'department',
  dist: 'distribution',
  dev: 'development'
}

export interface NormalizedEntity {
  original: string
  normalized: string
  legalSuffix?: string
  dbaName?: string
  tokens: string[]
}

export interface NormalizedAddress {
  original: string
  normalized: string
  street?: string
  city?: string
  state?: string
  zip?: string
  tokens: string[]
}

/**
 * Normalize a company name for matching
 */
export function normalizeCompanyName(name: string): NormalizedEntity {
  if (!name) {
    return { original: '', normalized: '', tokens: [] }
  }

  const original = name
  let normalized = name.toLowerCase().trim()

  // Extract DBA name if present
  let dbaName: string | undefined
  for (const indicator of DBA_INDICATORS) {
    const dbaIndex = normalized.indexOf(indicator)
    if (dbaIndex !== -1) {
      dbaName = normalized.substring(dbaIndex + indicator.length).trim()
      normalized = normalized.substring(0, dbaIndex).trim()
      break
    }
  }

  // Extract and remove legal suffix
  let legalSuffix: string | undefined
  for (const suffix of LEGAL_SUFFIXES) {
    // Match at end with optional comma/space before
    const pattern = new RegExp(`[,\\s]*(${escapeRegex(suffix)})\\s*$`, 'i')
    const match = normalized.match(pattern)
    if (match) {
      legalSuffix = match[1]
      normalized = normalized.replace(pattern, '').trim()
      break
    }
  }

  // Remove punctuation except apostrophes in names
  normalized = normalized.replace(/[^\w\s']/g, ' ')

  // Collapse multiple spaces
  normalized = normalized.replace(/\s+/g, ' ').trim()

  // Expand common abbreviations
  const words = normalized.split(' ')
  const expandedWords = words.map((word) => ABBREVIATIONS[word] || word)
  normalized = expandedWords.join(' ')

  // Remove common noise words for matching
  const noiseWords = ['the', 'a', 'an', 'of', 'and', '&']
  const tokens = expandedWords.filter((w) => !noiseWords.includes(w) && w.length > 0)

  return {
    original,
    normalized,
    legalSuffix,
    dbaName,
    tokens
  }
}

/**
 * Normalize a state name or abbreviation to 2-letter code
 */
export function normalizeState(state: string): string | null {
  if (!state) return null

  const cleaned = state.toLowerCase().trim()

  // Already a valid 2-letter abbreviation
  if (cleaned.length === 2) {
    const upper = cleaned.toUpperCase()
    // Verify it's a valid state abbreviation
    if (Object.values(STATE_ABBREVIATIONS).includes(upper)) {
      return upper
    }
  }

  // Look up full name
  return STATE_ABBREVIATIONS[cleaned] || null
}

/**
 * Normalize an address for matching
 */
export function normalizeAddress(address: string): NormalizedAddress {
  if (!address) {
    return { original: '', normalized: '', tokens: [] }
  }

  const original = address
  let normalized = address.toLowerCase().trim()

  // Common street abbreviations
  const streetAbbreviations: Record<string, string> = {
    st: 'street',
    'st.': 'street',
    ave: 'avenue',
    'ave.': 'avenue',
    blvd: 'boulevard',
    'blvd.': 'boulevard',
    dr: 'drive',
    'dr.': 'drive',
    rd: 'road',
    'rd.': 'road',
    ln: 'lane',
    'ln.': 'lane',
    ct: 'court',
    'ct.': 'court',
    pl: 'place',
    'pl.': 'place',
    cir: 'circle',
    'cir.': 'circle',
    pkwy: 'parkway',
    'pkwy.': 'parkway',
    hwy: 'highway',
    'hwy.': 'highway',
    n: 'north',
    'n.': 'north',
    s: 'south',
    's.': 'south',
    e: 'east',
    'e.': 'east',
    w: 'west',
    'w.': 'west',
    ne: 'northeast',
    nw: 'northwest',
    se: 'southeast',
    sw: 'southwest',
    ste: 'suite',
    'ste.': 'suite',
    apt: 'apartment',
    'apt.': 'apartment',
    fl: 'floor',
    'fl.': 'floor'
  }

  // Split by comma for city/state parsing
  const parts = normalized.split(',').map((p) => p.trim())

  let street: string | undefined
  let city: string | undefined
  let state: string | undefined
  let zip: string | undefined

  // Try to parse structured address
  if (parts.length >= 2) {
    street = parts[0]

    // Last part usually contains state and zip
    const lastPart = parts[parts.length - 1]
    const stateZipMatch = lastPart.match(/([a-z]{2})\s*(\d{5}(-\d{4})?)?$/i)
    if (stateZipMatch) {
      state = normalizeState(stateZipMatch[1]) || undefined
      zip = stateZipMatch[2] || undefined
    }

    // Second to last is usually city
    if (parts.length >= 3) {
      city = parts[parts.length - 2]
    } else {
      // City and state might be in same part
      const cityPart = lastPart.replace(/[a-z]{2}\s*\d{5}(-\d{4})?$/i, '').trim()
      if (cityPart) {
        city = cityPart
      }
    }
  }

  // Expand abbreviations
  const words = normalized.split(/\s+/)
  const expandedWords = words.map((word) => streetAbbreviations[word] || word)
  normalized = expandedWords.join(' ')

  // Remove punctuation
  normalized = normalized.replace(/[^\w\s]/g, ' ')
  normalized = normalized.replace(/\s+/g, ' ').trim()

  const tokens = expandedWords.filter((w) => w.length > 0)

  return {
    original,
    normalized,
    street,
    city,
    state,
    zip,
    tokens
  }
}

/**
 * Normalize a phone number to E.164 format
 */
export function normalizePhone(phone: string): string | null {
  if (!phone) return null

  // Remove all non-numeric characters
  const digits = phone.replace(/\D/g, '')

  // US phone numbers
  if (digits.length === 10) {
    return `+1${digits}`
  }
  if (digits.length === 11 && digits[0] === '1') {
    return `+${digits}`
  }

  // Already has country code
  if (digits.length > 10) {
    return `+${digits}`
  }

  return null
}

/**
 * Normalize an email address
 */
export function normalizeEmail(email: string): string | null {
  if (!email) return null

  const normalized = email.toLowerCase().trim()

  // Basic validation
  if (!normalized.includes('@') || !normalized.includes('.')) {
    return null
  }

  return normalized
}

/**
 * Extract all names/aliases from a company name string
 */
export function extractAliases(name: string): string[] {
  const result: string[] = []

  // Primary name
  const primary = normalizeCompanyName(name)
  result.push(primary.normalized)

  // DBA name
  if (primary.dbaName) {
    const dba = normalizeCompanyName(primary.dbaName)
    result.push(dba.normalized)
  }

  return result.filter((v, i, a) => a.indexOf(v) === i) // Unique
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Generate search tokens from a company name
 * These are used for indexing and fast lookup
 */
export function generateSearchTokens(name: string): string[] {
  const normalized = normalizeCompanyName(name)

  const tokens: string[] = []

  // Full normalized name
  tokens.push(normalized.normalized)

  // Individual words (min 2 chars)
  normalized.tokens.filter((t) => t.length >= 2).forEach((t) => tokens.push(t))

  // Bigrams for partial matching
  if (normalized.tokens.length >= 2) {
    for (let i = 0; i < normalized.tokens.length - 1; i++) {
      tokens.push(`${normalized.tokens[i]} ${normalized.tokens[i + 1]}`)
    }
  }

  // DBA tokens
  if (normalized.dbaName) {
    const dba = normalizeCompanyName(normalized.dbaName)
    dba.tokens.filter((t) => t.length >= 2).forEach((t) => tokens.push(t))
  }

  return [...new Set(tokens)]
}
