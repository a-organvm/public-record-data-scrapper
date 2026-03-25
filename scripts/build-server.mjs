import { build } from 'esbuild'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

await build({
  entryPoints: [resolve(__dirname, '../server/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: resolve(__dirname, '../dist/server.cjs'),
  external: [
    // Node built-ins
    'fs', 'path', 'os', 'crypto', 'http', 'https', 'net', 'tls',
    'stream', 'url', 'zlib', 'events', 'util', 'buffer', 'querystring',
    'child_process', 'cluster', 'dgram', 'dns', 'readline', 'string_decoder',
    'timers', 'tty', 'v8', 'vm', 'worker_threads', 'perf_hooks',
    'async_hooks', 'diagnostics_channel', 'inspector', 'trace_events',
    'assert', 'console',
    // Native modules that can't be bundled
    'pg-native',
    'bullmq',
    'ioredis',
    'pg',
    'puppeteer',
    'sharp',
  ],
  sourcemap: true,
  minify: false,
  keepNames: true,
  define: {
    'import.meta.url': 'import_meta_url',
  },
  banner: {
    js: [
      'const import_meta_url = require("url").pathToFileURL(__filename).href;',
      'const __filename_esm = __filename;',
    ].join('\n'),
  },
})

console.log('✓ Server bundled to dist/server.cjs')
