/**
 * Database Connection
 *
 * This module provides backward-compatible database access using the
 * canonical DatabaseClient from @public-records/core.
 */

import { PoolClient } from 'pg'
import {
  DatabaseClient,
  getDatabase,
  initDatabase,
  closeDatabase as closeDatabaseCore,
  setOrgContextProvider,
  type DatabaseConfig
} from '../../packages/core/src/database'
import { config } from '../config'
import { getCurrentOrgId } from '../middleware/orgContext'

// Inject the per-request tenant resolver into @public-records/core so the core
// Database client can SET `app.current_org_id` (for migration 018's RLS
// policies) without taking a hard dependency on server middleware. Registered
// once at module load. With no active org context the provider returns
// undefined and core uses its plain pool.query passthrough.
//
// RLS note: the GUC only changes row visibility when the app connects as a
// NON-OWNER DB role; the owner/superuser bypasses the (non-FORCEd) policies,
// and migrations run as the owner by design.
setOrgContextProvider(getCurrentOrgId)

// Re-export types for convenience
export { DatabaseClient, type DatabaseConfig }

class Database {
  private client: DatabaseClient | null = null

  async connect(): Promise<void> {
    if (this.client) {
      console.log('Database already connected')
      return
    }

    const dbConfig: DatabaseConfig = {
      connectionString: config.database.url,
      max: config.database.maxConnections,
      idleTimeoutMillis: config.database.idleTimeoutMillis,
      connectionTimeoutMillis: config.database.connectionTimeoutMillis
    }

    try {
      this.client = initDatabase(dbConfig)

      // Test connection
      const isConnected = await this.client.ping()
      if (isConnected) {
        console.log('✓ Database connected')
      } else {
        throw new Error('Database ping failed')
      }
    } catch (error) {
      console.error('✗ Database connection failed:', error)
      throw error
    }
  }

  async disconnect(): Promise<void> {
    if (!this.client) {
      console.log('Database not connected')
      return
    }

    await closeDatabaseCore()
    this.client = null
    console.log('✓ Database disconnected')
  }

  getClient(): DatabaseClient {
    if (!this.client) {
      throw new Error('Database not connected. Call connect() first.')
    }
    return this.client
  }

  async query<T = Record<string, unknown>>(text: string, params?: Array<unknown>): Promise<T[]> {
    const client = this.getClient()
    return client.queryRows<T>(text, params)
  }

  async getPoolClient(): Promise<PoolClient> {
    const client = this.getClient()
    return client.getClient()
  }

  /**
   * @deprecated Use getPoolClient() instead
   */
  async getClient_deprecated(): Promise<PoolClient> {
    return this.getPoolClient()
  }
}

export const database = new Database()

// Also export the singleton accessor for consistency
export { getDatabase, closeDatabaseCore as closeDatabase }
