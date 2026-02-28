export {
  normalizeCompanyName,
  normalizeAddress,
  normalizeState,
  normalizePhone,
  normalizeEmail,
  extractAliases,
  generateSearchTokens,
  type NormalizedEntity,
  type NormalizedAddress
} from './normalize'

export {
  levenshteinDistance,
  levenshteinSimilarity,
  jaroWinklerSimilarity,
  soundex,
  metaphone,
  phoneticSimilarity,
  tokenOverlap,
  fuzzyTokenOverlap,
  addressProximity,
  matchEntities,
  findBestMatches,
  clusterEntities,
  type MatchResult,
  type Entity,
  type MatcherConfig
} from './matcher'
