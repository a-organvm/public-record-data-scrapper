/**
 * Data Pipeline Configuration
 *
 * Central configuration for data ingestion, enrichment, and scheduling
 */

import { IngestionConfig, DataSource, EnrichmentSource, ScheduleConfig } from '../services'

/**
 * Environment-based configuration
 */
export const getEnvironment = (): 'development' | 'production' => {
  return import.meta.env.MODE === 'production' ? 'production' : 'development'
}

/**
 * Data source configuration
 */
export const dataSources: Record<string, DataSource[]> = {
  development: [
    {
      id: 'demo-api',
      name: 'Demo UCC API',
      type: 'api',
      endpoint: 'https://api.demo.ucc-filings.com/v1',
      rateLimit: 60 // 60 requests per minute
    },
    {
      id: 'ny-portal',
      name: 'New York UCC Portal',
      type: 'state-portal',
      endpoint: 'https://appext20.dos.ny.gov/pls/ucc_public/web_search.main_frame',
      rateLimit: 30
    }
  ],
  production: [
    {
      id: 'production-api',
      name: 'Production UCC API',
      type: 'api',
      endpoint: import.meta.env.VITE_UCC_API_ENDPOINT || 'https://api.ucc-filings.com/v1',
      apiKey: import.meta.env.VITE_UCC_API_KEY,
      rateLimit: 100
    },
    {
      id: 'database',
      name: 'UCC Database',
      type: 'database',
      endpoint: import.meta.env.VITE_DB_ENDPOINT || 'postgresql://localhost:5432/ucc',
      rateLimit: 1000
    }
  ]
}

/**
 * Enrichment source configuration
 */
export const enrichmentSources: Record<string, EnrichmentSource[]> = {
  development: [
    {
      id: 'web-scraper-dev',
      name: 'Web Scraper (Dev)',
      type: 'web-scraping',
      capabilities: ['growth-signals', 'health-score']
    },
    {
      id: 'ml-inference-dev',
      name: 'ML Inference (Dev)',
      type: 'ml-inference',
      capabilities: ['revenue-estimate', 'industry-classification']
    }
  ],
  production: [
    {
      id: 'web-scraper',
      name: 'Web Scraper',
      type: 'web-scraping',
      capabilities: ['growth-signals', 'health-score'],
      endpoint: import.meta.env.VITE_SCRAPER_ENDPOINT
    },
    {
      id: 'ml-api',
      name: 'ML API',
      type: 'api',
      capabilities: ['revenue-estimate', 'industry-classification'],
      endpoint: import.meta.env.VITE_ML_API_ENDPOINT,
      apiKey: import.meta.env.VITE_ML_API_KEY
    }
  ]
}

/**
 * Ingestion configuration
 */
export const ingestionConfig: Record<string, IngestionConfig> = {
  development: {
    sources: dataSources.development,
    batchSize: 50,
    retryAttempts: 3,
    retryDelay: 2000,
    states: ['NY', 'CA', 'TX'] // Limited states for dev
  },
  production: {
    sources: dataSources.production,
    batchSize: 100,
    retryAttempts: 5,
    retryDelay: 5000,
    states: ['NY', 'CA', 'TX', 'FL', 'IL', 'PA', 'OH', 'GA', 'NC', 'MI']
  }
}

/**
 * Scheduler configuration
 */
export const scheduleConfig: Record<string, ScheduleConfig> = {
  development: {
    enabled: true,
    ingestionInterval: 60 * 60 * 1000, // 1 hour (faster for dev)
    enrichmentInterval: 30 * 60 * 1000, // 30 minutes
    enrichmentBatchSize: 25,
    refreshInterval: 30 * 60 * 1000, // 30 minutes
    staleDataThreshold: 1, // 1 day
    autoStart: false // Manual start in dev
  },
  production: {
    enabled: true,
    ingestionInterval: 24 * 60 * 60 * 1000, // 24 hours
    enrichmentInterval: 6 * 60 * 60 * 1000, // 6 hours
    enrichmentBatchSize: 50,
    refreshInterval: 12 * 60 * 60 * 1000, // 12 hours
    staleDataThreshold: 7, // 7 days
    autoStart: true
  }
}

/**
 * Get configuration for current environment
 */
export const getDataPipelineConfig = () => {
  const env = getEnvironment()

  return {
    environment: env,
    ingestion: ingestionConfig[env],
    enrichment: enrichmentSources[env],
    schedule: scheduleConfig[env]
  }
}

/**
 * Feature flags
 */
const demoDataEnabled = import.meta.env.VITE_USE_MOCK_DATA === 'true'

export const featureFlags = {
  enableRealTimeIngestion: import.meta.env.VITE_ENABLE_REALTIME_INGESTION === 'true',
  enableMLEnrichment: import.meta.env.VITE_ENABLE_ML_ENRICHMENT === 'true',
  enableAutoRefresh: import.meta.env.VITE_ENABLE_AUTO_REFRESH === 'true',
  useDemoData: demoDataEnabled,
  useMockData: demoDataEnabled,
  debugMode: import.meta.env.MODE === 'development'
}
