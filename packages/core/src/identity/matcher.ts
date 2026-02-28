/**
 * Fuzzy Matching Engine
 *
 * Provides algorithms for matching company names, addresses, and other
 * entity data with configurable thresholds and scoring.
 */

import { normalizeCompanyName, normalizeAddress, type NormalizedAddress } from './normalize'

export interface MatchResult {
  score: number // 0-100 confidence score
  isMatch: boolean // Whether it meets threshold
  details: {
    levenshtein: number
    tokenOverlap: number
    phonetic: number
    addressProximity?: number
  }
  matchType: 'exact' | 'strong' | 'moderate' | 'weak' | 'none'
}

export interface Entity {
  name: string
  address?: string
  city?: string
  state?: string
  zip?: string
  phone?: string
}

export interface MatcherConfig {
  /** Minimum score (0-100) to consider a match */
  threshold: number
  /** Weight for Levenshtein distance (0-1) */
  levenshteinWeight: number
  /** Weight for token overlap (0-1) */
  tokenWeight: number
  /** Weight for phonetic matching (0-1) */
  phoneticWeight: number
  /** Weight for address proximity (0-1) */
  addressWeight: number
  /** Whether to use phonetic matching */
  usePhonetic: boolean
}

const DEFAULT_CONFIG: MatcherConfig = {
  threshold: 70,
  levenshteinWeight: 0.4,
  tokenWeight: 0.35,
  phoneticWeight: 0.15,
  addressWeight: 0.1,
  usePhonetic: true
}

/**
 * Calculate Levenshtein distance between two strings
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  const matrix: number[][] = []

  // Initialize matrix
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }

  // Fill in the rest of the matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        )
      }
    }
  }

  return matrix[b.length][a.length]
}

/**
 * Calculate normalized Levenshtein similarity (0-1)
 */
export function levenshteinSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1

  const distance = levenshteinDistance(a, b)
  return 1 - distance / maxLen
}

/**
 * Calculate Jaro-Winkler similarity (0-1)
 * Better for short strings and typos
 */
export function jaroWinklerSimilarity(a: string, b: string): number {
  if (a === b) return 1
  if (a.length === 0 || b.length === 0) return 0

  const matchWindow = Math.floor(Math.max(a.length, b.length) / 2) - 1
  const aMatches: boolean[] = new Array(a.length).fill(false)
  const bMatches: boolean[] = new Array(b.length).fill(false)

  let matches = 0
  let transpositions = 0

  // Find matches
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchWindow)
    const end = Math.min(i + matchWindow + 1, b.length)

    for (let j = start; j < end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue
      aMatches[i] = true
      bMatches[j] = true
      matches++
      break
    }
  }

  if (matches === 0) return 0

  // Count transpositions
  let k = 0
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue
    while (!bMatches[k]) k++
    if (a[i] !== b[k]) transpositions++
    k++
  }

  const jaro =
    (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3

  // Winkler modification for common prefix
  let prefix = 0
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++
    else break
  }

  return jaro + prefix * 0.1 * (1 - jaro)
}

/**
 * Soundex encoding for phonetic matching
 */
export function soundex(word: string): string {
  if (!word) return ''

  const codes: Record<string, string> = {
    b: '1',
    f: '1',
    p: '1',
    v: '1',
    c: '2',
    g: '2',
    j: '2',
    k: '2',
    q: '2',
    s: '2',
    x: '2',
    z: '2',
    d: '3',
    t: '3',
    l: '4',
    m: '5',
    n: '5',
    r: '6'
  }

  const chars = word.toLowerCase().split('')
  let result = chars[0].toUpperCase()
  let prevCode = codes[chars[0]] || ''

  for (let i = 1; i < chars.length && result.length < 4; i++) {
    const code = codes[chars[i]]
    if (code && code !== prevCode) {
      result += code
      prevCode = code
    } else if (!code) {
      prevCode = ''
    }
  }

  return result.padEnd(4, '0')
}

/**
 * Double Metaphone encoding for better phonetic matching
 * Simplified implementation
 */
export function metaphone(word: string): string {
  if (!word) return ''

  let str = word.toUpperCase()

  // Simple consonant mappings
  str = str.replace(/^KN|GN|PN|AE|WR/g, 'N')
  str = str.replace(/MB$/g, 'M')
  str = str.replace(/CK/g, 'K')
  str = str.replace(/PH/g, 'F')
  str = str.replace(/X/g, 'KS')
  str = str.replace(/SH/g, 'X')
  str = str.replace(/C(?=[IEY])/g, 'S')
  str = str.replace(/C/g, 'K')
  str = str.replace(/G(?=[IEY])/g, 'J')
  str = str.replace(/GN/g, 'N')
  str = str.replace(/D(?=G[IEY])/g, 'J')
  str = str.replace(/D/g, 'T')
  str = str.replace(/[AEIOU]/g, '')
  str = str.replace(/(.)\1+/g, '$1') // Remove duplicates

  return str.slice(0, 4)
}

/**
 * Calculate phonetic similarity between two strings
 */
export function phoneticSimilarity(a: string, b: string): number {
  const soundexA = soundex(a)
  const soundexB = soundex(b)
  const metaphoneA = metaphone(a)
  const metaphoneB = metaphone(b)

  // Count matching characters
  let soundexMatch = 0
  for (let i = 0; i < 4; i++) {
    if (soundexA[i] === soundexB[i]) soundexMatch++
  }

  let metaphoneMatch = 0
  const minLen = Math.min(metaphoneA.length, metaphoneB.length)
  for (let i = 0; i < minLen; i++) {
    if (metaphoneA[i] === metaphoneB[i]) metaphoneMatch++
  }
  const maxLen = Math.max(metaphoneA.length, metaphoneB.length)

  const soundexScore = soundexMatch / 4
  const metaphoneScore = maxLen > 0 ? metaphoneMatch / maxLen : 0

  // Weight metaphone slightly higher as it's more accurate
  return soundexScore * 0.4 + metaphoneScore * 0.6
}

/**
 * Calculate token overlap between two sets of tokens
 */
export function tokenOverlap(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 || tokensB.length === 0) return 0

  const setA = new Set(tokensA)
  const setB = new Set(tokensB)

  let intersectionSize = 0
  for (const token of setA) {
    if (setB.has(token)) intersectionSize++
  }

  // Jaccard similarity
  const unionSize = setA.size + setB.size - intersectionSize
  return unionSize > 0 ? intersectionSize / unionSize : 0
}

/**
 * Calculate token overlap with fuzzy matching
 */
export function fuzzyTokenOverlap(
  tokensA: string[],
  tokensB: string[],
  threshold: number = 0.8
): number {
  if (tokensA.length === 0 || tokensB.length === 0) return 0

  let matches = 0
  const matchedB = new Set<number>()

  for (const tokenA of tokensA) {
    let bestMatch = 0
    let bestIndex = -1

    for (let i = 0; i < tokensB.length; i++) {
      if (matchedB.has(i)) continue

      const sim = jaroWinklerSimilarity(tokenA, tokensB[i])
      if (sim > bestMatch) {
        bestMatch = sim
        bestIndex = i
      }
    }

    if (bestMatch >= threshold && bestIndex >= 0) {
      matches += bestMatch
      matchedB.add(bestIndex)
    }
  }

  const maxPossible = Math.max(tokensA.length, tokensB.length)
  return maxPossible > 0 ? matches / maxPossible : 0
}

/**
 * Calculate address proximity score
 */
export function addressProximity(addrA: NormalizedAddress, addrB: NormalizedAddress): number {
  let score = 0
  let factors = 0

  // Same ZIP code is a strong signal
  if (addrA.zip && addrB.zip) {
    factors++
    if (addrA.zip === addrB.zip) {
      score += 1
    } else if (addrA.zip.slice(0, 3) === addrB.zip.slice(0, 3)) {
      score += 0.5 // Same ZIP3
    }
  }

  // Same state
  if (addrA.state && addrB.state) {
    factors++
    if (addrA.state === addrB.state) {
      score += 1
    }
  }

  // Same city
  if (addrA.city && addrB.city) {
    factors++
    const citySim = jaroWinklerSimilarity(addrA.city, addrB.city)
    score += citySim
  }

  // Street similarity
  if (addrA.street && addrB.street) {
    factors++
    const streetSim = jaroWinklerSimilarity(addrA.street, addrB.street)
    score += streetSim
  }

  return factors > 0 ? score / factors : 0
}

/**
 * Match two entities and return a detailed match result
 */
export function matchEntities(
  a: Entity,
  b: Entity,
  config: Partial<MatcherConfig> = {}
): MatchResult {
  const cfg = { ...DEFAULT_CONFIG, ...config }

  // Normalize names
  const normA = normalizeCompanyName(a.name)
  const normB = normalizeCompanyName(b.name)

  // Calculate individual scores
  const levScore = jaroWinklerSimilarity(normA.normalized, normB.normalized)
  const tokenScore = fuzzyTokenOverlap(normA.tokens, normB.tokens)

  let phoneticScore = 0
  if (cfg.usePhonetic) {
    // Phonetic on first significant word
    const firstA = normA.tokens[0] || ''
    const firstB = normB.tokens[0] || ''
    phoneticScore = phoneticSimilarity(firstA, firstB)
  }

  let addressScore = 0
  if (a.address && b.address) {
    const addrA = normalizeAddress(a.address)
    const addrB = normalizeAddress(b.address)
    addressScore = addressProximity(addrA, addrB)
  } else if (a.state && b.state) {
    // At least check state
    addressScore = a.state.toUpperCase() === b.state.toUpperCase() ? 0.5 : 0
  }

  // Calculate weighted score
  const totalWeight =
    cfg.levenshteinWeight +
    cfg.tokenWeight +
    (cfg.usePhonetic ? cfg.phoneticWeight : 0) +
    (a.address || b.address ? cfg.addressWeight : 0)

  const weightedScore =
    (levScore * cfg.levenshteinWeight +
      tokenScore * cfg.tokenWeight +
      (cfg.usePhonetic ? phoneticScore * cfg.phoneticWeight : 0) +
      addressScore * cfg.addressWeight) /
    totalWeight

  const score = Math.round(weightedScore * 100)

  // Determine match type
  let matchType: MatchResult['matchType']
  if (score >= 95) {
    matchType = 'exact'
  } else if (score >= 85) {
    matchType = 'strong'
  } else if (score >= cfg.threshold) {
    matchType = 'moderate'
  } else if (score >= cfg.threshold - 15) {
    matchType = 'weak'
  } else {
    matchType = 'none'
  }

  return {
    score,
    isMatch: score >= cfg.threshold,
    details: {
      levenshtein: Math.round(levScore * 100),
      tokenOverlap: Math.round(tokenScore * 100),
      phonetic: Math.round(phoneticScore * 100),
      addressProximity: Math.round(addressScore * 100)
    },
    matchType
  }
}

/**
 * Find best matches for an entity in a list
 */
export function findBestMatches(
  entity: Entity,
  candidates: Entity[],
  config: Partial<MatcherConfig> = {},
  limit: number = 5
): Array<{ entity: Entity; match: MatchResult }> {
  const results = candidates.map((candidate) => ({
    entity: candidate,
    match: matchEntities(entity, candidate, config)
  }))

  // Sort by score descending
  results.sort((a, b) => b.match.score - a.match.score)

  // Filter by threshold and limit
  const threshold = config.threshold ?? DEFAULT_CONFIG.threshold
  return results.filter((r) => r.match.score >= threshold).slice(0, limit)
}

/**
 * Cluster entities by similarity
 */
export function clusterEntities(
  entities: Entity[],
  config: Partial<MatcherConfig> = {}
): Entity[][] {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const clusters: Entity[][] = []
  const assigned = new Set<number>()

  for (let i = 0; i < entities.length; i++) {
    if (assigned.has(i)) continue

    const cluster: Entity[] = [entities[i]]
    assigned.add(i)

    for (let j = i + 1; j < entities.length; j++) {
      if (assigned.has(j)) continue

      const match = matchEntities(entities[i], entities[j], cfg)
      if (match.isMatch) {
        cluster.push(entities[j])
        assigned.add(j)
      }
    }

    clusters.push(cluster)
  }

  return clusters
}
