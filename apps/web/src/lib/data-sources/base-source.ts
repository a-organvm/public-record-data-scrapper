/**
 * Base Data Source
 *
 * Thin re-export of the shared implementation in
 * `@public-records/core/enrichment`. The canonical source now lives in
 * packages/core so the web app and the Express server share one
 * implementation. This file is retained so existing
 * `../data-sources/base-source` imports keep working unchanged.
 */

export {
  BaseDataSource,
  type DataSourceConfig,
  type DataSourceResponse,
  type SubscriptionTier
} from '@public-records/core/enrichment'
