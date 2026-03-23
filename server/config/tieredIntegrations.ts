import type { ResolvedDataTier } from '../middleware/dataTier'

type ApiCredential = {
  apiKey?: string
  username?: string
  customerId?: string
}

export type TieredIntegrationConfig = {
  dnb?: ApiCredential
  googlePlaces?: ApiCredential
  clearbit?: ApiCredential
  newsApi?: ApiCredential
  uccCsc?: ApiCredential
  uccCtCorp?: ApiCredential
  uccLexisNexis?: ApiCredential
}

const TIER_ENV_PREFIX: Record<ResolvedDataTier, string> = {
  'free-tier': 'FREE_TIER',
  'starter-tier': 'STARTER_TIER'
}

function getTieredEnvValue(
  dataTier: ResolvedDataTier,
  envKey: string,
  fallbackKey?: string
): string {
  const prefix = TIER_ENV_PREFIX[dataTier]
  return (
    process.env[`${prefix}_${envKey}`] ||
    (fallbackKey ? process.env[fallbackKey] : process.env[envKey]) ||
    ''
  )
}

export function getTieredIntegrationConfig(dataTier: ResolvedDataTier): TieredIntegrationConfig {
  return {
    dnb: { apiKey: getTieredEnvValue(dataTier, 'DNB_API_KEY') },
    googlePlaces: { apiKey: getTieredEnvValue(dataTier, 'GOOGLE_PLACES_API_KEY') },
    clearbit: { apiKey: getTieredEnvValue(dataTier, 'CLEARBIT_API_KEY') },
    newsApi: { apiKey: getTieredEnvValue(dataTier, 'NEWS_API_KEY') },
    uccCsc: {
      apiKey: getTieredEnvValue(dataTier, 'CSC_UCC_API_KEY'),
      username: getTieredEnvValue(dataTier, 'CSC_UCC_USERNAME')
    },
    uccCtCorp: { apiKey: getTieredEnvValue(dataTier, 'CTCORP_API_KEY') },
    uccLexisNexis: {
      apiKey: getTieredEnvValue(dataTier, 'LEXISNEXIS_API_KEY'),
      customerId: getTieredEnvValue(dataTier, 'LEXISNEXIS_CUSTOMER_ID')
    }
  }
}

export function listEnabledIntegrations(dataTier: ResolvedDataTier): string[] {
  const config = getTieredIntegrationConfig(dataTier)
  return Object.entries(config)
    .filter(([, value]) => value?.apiKey && value.apiKey.trim().length > 0)
    .map(([name]) => name)
}

export type UccProvider = 'csc' | 'ctcorp' | 'lexisnexis' | 'unconfigured'

export function resolveUccProvider(dataTier: ResolvedDataTier): UccProvider {
  const config = getTieredIntegrationConfig(dataTier)
  if (config.uccCsc?.apiKey && config.uccCsc?.username) return 'csc'
  if (config.uccCtCorp?.apiKey) return 'ctcorp'
  if (config.uccLexisNexis?.apiKey && config.uccLexisNexis?.customerId) return 'lexisnexis'
  return 'unconfigured'
}
