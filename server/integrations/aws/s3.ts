/**
 * AWS S3 Client
 *
 * Provides document storage capabilities using Amazon S3.
 * Supports uploading, downloading (via presigned URLs), and deleting documents.
 *
 * Environment variables required:
 * - AWS_ACCESS_KEY_ID: AWS access key
 * - AWS_SECRET_ACCESS_KEY: AWS secret key
 * - AWS_REGION: AWS region (default: us-east-1)
 * - S3_BUCKET_NAME: S3 bucket for document storage
 */

import { randomUUID } from 'crypto'

export interface S3Config {
  accessKeyId: string
  secretAccessKey: string
  region: string
  bucketName: string
  endpoint?: string
}

export interface S3Response<T> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
  }
}

export interface UploadResult {
  key: string
  bucket: string
  location: string
  etag: string
  contentType: string
  size: number
}

export interface PresignedUrlResult {
  url: string
  expiresAt: string
}

/**
 * S3Client provides document storage operations.
 */
export class S3Client {
  private config: S3Config
  private initialized: boolean = false

  constructor(customConfig?: Partial<S3Config>) {
    this.config = {
      accessKeyId: customConfig?.accessKeyId || process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: customConfig?.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY || '',
      region: customConfig?.region || process.env.AWS_REGION || 'us-east-1',
      bucketName: customConfig?.bucketName || process.env.S3_BUCKET_NAME || 'mca-documents',
      endpoint: customConfig?.endpoint || process.env.S3_ENDPOINT
    }
  }

  /**
   * Initialize the S3 client
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    if (!this.config.accessKeyId || !this.config.secretAccessKey) {
      console.warn('[S3Client] Missing AWS credentials - S3 storage is disabled')
    }

    if (!this.config.bucketName) {
      console.warn('[S3Client] Missing S3_BUCKET_NAME - using default bucket name')
    }

    this.initialized = true
    console.log('[S3Client] Initialized', {
      region: this.config.region,
      bucket: this.config.bucketName,
      storageReady: this.isConfigured()
    })
  }

  /**
   * Check if client is configured with valid credentials
   */
  isConfigured(): boolean {
    return !!(this.config.accessKeyId && this.config.secretAccessKey && this.config.bucketName)
  }

  /**
   * Get the configured bucket name
   */
  getBucketName(): string {
    return this.config.bucketName
  }

  /**
   * Get the configured region
   */
  getRegion(): string {
    return this.config.region
  }

  /**
   * Upload a document to S3
   *
   * @param prospectId - The prospect ID to associate with the document
   * @param buffer - The file buffer to upload
   * @param mimetype - The MIME type of the file
   * @returns The S3 key where the document was stored
   */
  async uploadDocument(prospectId: string, buffer: Buffer, mimetype: string): Promise<string> {
    const extension = this.getExtensionFromMimetype(mimetype)
    const documentId = randomUUID()
    const key = `prospects/${prospectId}/${documentId}${extension}`

    void buffer
    void mimetype
    this.assertConfigured('uploadDocument')
    return this.throwUnsupported(`uploadDocument for ${key}`)
  }

  /**
   * Upload a document with a specific key
   *
   * @param key - The full S3 key for the document
   * @param buffer - The file buffer to upload
   * @param mimetype - The MIME type of the file
   * @param metadata - Optional metadata to attach
   * @returns Upload result with location and etag
   */
  async upload(
    key: string,
    buffer: Buffer,
    mimetype: string,
    metadata?: Record<string, string>
  ): Promise<S3Response<UploadResult>> {
    void buffer
    void mimetype
    void metadata
    this.assertConfigured('upload')
    return this.throwUnsupported(`upload for ${key}`)
  }

  /**
   * Generate a presigned URL for downloading a document
   *
   * @param key - The S3 key of the document
   * @param expiresInSeconds - URL expiration time (default: 3600 seconds / 1 hour)
   * @returns A presigned URL for downloading the document
   */
  async getPresignedUrl(key: string, expiresInSeconds: number = 3600): Promise<string> {
    void expiresInSeconds
    this.assertConfigured('getPresignedUrl')
    return this.throwUnsupported(`getPresignedUrl for ${key}`)
  }

  /**
   * Get a presigned URL with expiration info
   *
   * @param key - The S3 key of the document
   * @param expiresInSeconds - URL expiration time (default: 3600 seconds / 1 hour)
   * @returns Presigned URL result with expiration timestamp
   */
  async getPresignedUrlWithExpiry(
    key: string,
    expiresInSeconds: number = 3600
  ): Promise<S3Response<PresignedUrlResult>> {
    const url = await this.getPresignedUrl(key, expiresInSeconds)
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000)

    return {
      success: true,
      data: {
        url,
        expiresAt: expiresAt.toISOString()
      }
    }
  }

  /**
   * Generate a presigned URL for uploading a document
   *
   * @param key - The S3 key where the document will be uploaded
   * @param mimetype - The expected MIME type of the upload
   * @param expiresInSeconds - URL expiration time (default: 3600 seconds / 1 hour)
   * @returns A presigned URL for uploading
   */
  async getPresignedUploadUrl(
    key: string,
    mimetype: string,
    expiresInSeconds: number = 3600
  ): Promise<string> {
    void mimetype
    void expiresInSeconds
    this.assertConfigured('getPresignedUploadUrl')
    return this.throwUnsupported(`getPresignedUploadUrl for ${key}`)
  }

  /**
   * Delete a document from S3
   *
   * @param key - The S3 key of the document to delete
   */
  async deleteDocument(key: string): Promise<void> {
    this.assertConfigured('deleteDocument')
    this.throwUnsupported(`deleteDocument for ${key}`)
  }

  /**
   * Delete multiple documents from S3
   *
   * @param keys - Array of S3 keys to delete
   * @returns Results of the delete operation
   */
  async deleteDocuments(
    keys: string[]
  ): Promise<S3Response<{ deleted: string[]; errors: string[] }>> {
    this.assertConfigured('deleteDocuments')
    return this.throwUnsupported(`deleteDocuments for ${keys.length} keys`)
  }

  /**
   * Check if a document exists in S3
   *
   * @param key - The S3 key to check
   * @returns True if the document exists
   */
  async documentExists(key: string): Promise<boolean> {
    this.assertConfigured('documentExists')
    return this.throwUnsupported(`documentExists for ${key}`)
  }

  /**
   * List documents in a prefix path
   *
   * @param prefix - The S3 prefix to list (e.g., 'prospects/123/')
   * @param maxKeys - Maximum number of keys to return (default: 1000)
   * @returns Array of document keys
   */
  async listDocuments(prefix: string, maxKeys: number = 1000): Promise<string[]> {
    void maxKeys
    this.assertConfigured('listDocuments')
    return this.throwUnsupported(`listDocuments for ${prefix}`)
  }

  /**
   * Copy a document to a new location
   *
   * @param sourceKey - The source S3 key
   * @param destinationKey - The destination S3 key
   * @returns The destination key
   */
  async copyDocument(sourceKey: string, destinationKey: string): Promise<string> {
    this.assertConfigured('copyDocument')
    return this.throwUnsupported(`copyDocument from ${sourceKey} to ${destinationKey}`)
  }

  /**
   * Generate a document key for a prospect
   *
   * @param prospectId - The prospect ID
   * @param filename - Original filename
   * @param category - Optional category (e.g., 'bank-statements', 'tax-returns')
   * @returns Generated S3 key
   */
  generateDocumentKey(prospectId: string, filename: string, category?: string): string {
    const documentId = randomUUID()
    const sanitizedFilename = this.sanitizeFilename(filename)

    if (category) {
      return `prospects/${prospectId}/${category}/${documentId}-${sanitizedFilename}`
    }

    return `prospects/${prospectId}/${documentId}-${sanitizedFilename}`
  }

  /**
   * Get file extension from MIME type
   */
  private getExtensionFromMimetype(mimetype: string): string {
    const mimeToExt: Record<string, string> = {
      'application/pdf': '.pdf',
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'application/msword': '.doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
      'application/vnd.ms-excel': '.xls',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
      'text/plain': '.txt',
      'text/csv': '.csv',
      'application/json': '.json',
      'application/zip': '.zip'
    }

    return mimeToExt[mimetype] || ''
  }

  /**
   * Sanitize filename for S3 key
   */
  private sanitizeFilename(filename: string): string {
    // Remove extension first
    const lastDot = filename.lastIndexOf('.')
    const nameWithoutExt = lastDot === -1 ? filename : filename.substring(0, lastDot)
    const ext = lastDot === -1 ? '' : filename.substring(lastDot)

    // Replace unsafe characters, keep alphanumeric, hyphens, underscores
    const sanitized = nameWithoutExt
      .toLowerCase()
      .replace(/[^a-z0-9\-_]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 100) // Limit length

    return sanitized + ext
  }

  /**
   * Build the full S3 URL for a key
   */
  getS3Url(key: string): string {
    if (this.config.endpoint) {
      return `${this.config.endpoint}/${this.config.bucketName}/${key}`
    }
    return `https://${this.config.bucketName}.s3.${this.config.region}.amazonaws.com/${key}`
  }

  private assertConfigured(operation: string): void {
    if (!this.isConfigured()) {
      throw new Error(`S3 client is not configured for ${operation}`)
    }
  }

  private throwUnsupported(operation: string): never {
    throw new Error(
      `S3Client is not wired to the AWS SDK for ${operation}. Configure a production storage adapter before enabling document storage.`
    )
  }
}

// Export singleton instance
export const s3Client = new S3Client()
