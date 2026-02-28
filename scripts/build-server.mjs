#!/usr/bin/env node
/**
 * Build server for Render deployment using esbuild.
 * Bundles server/index.ts + all workspace packages (@public-records/core)
 * into a single dist/server.js file.
 */

import { build } from 'esbuild'
import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

async function buildServer() {
  console.log('[build-server] Building server bundle with esbuild...')

  await build({
    entryPoints: [join(root, 'server/index.ts')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outfile: join(root, 'dist/server.js'),
    sourcemap: true,
    minify: false,
    // Externalize native node modules and packages that shouldn't be bundled
    external: [
      // Native modules
      'pg-native',
      'bufferutil',
      'utf-8-validate',
      // Puppeteer (not needed for API server on Render)
      'puppeteer',
      'puppeteer-core',
      // Optional peer deps
      '@swc/core',
      'fsevents',
    ],
    // Resolve workspace packages by aliasing them to their source
    alias: {
      '@public-records/core': join(root, 'packages/core/src/index.ts'),
      '@public-records/core/database': join(root, 'packages/core/src/database/index.ts'),
      '@public-records/core/types': join(root, 'packages/core/src/types.ts'),
      '@public-records/core/identity': join(root, 'packages/core/src/identity/index.ts'),
    },
    // Define for tree-shaking
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    logLevel: 'info',
  })

  // Copy OpenAPI spec to dist
  const openapiSrc = join(root, 'server/openapi.yaml')
  const openapiDest = join(root, 'dist/openapi.yaml')
  if (existsSync(openapiSrc)) {
    mkdirSync(dirname(openapiDest), { recursive: true })
    copyFileSync(openapiSrc, openapiDest)
    console.log('[build-server] Copied openapi.yaml to dist/')
  }

  console.log('[build-server] Server build complete: dist/server.js')
}

buildServer().catch((err) => {
  console.error('[build-server] Build failed:', err)
  process.exit(1)
})
