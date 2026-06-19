import { build } from 'esbuild'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

// Plugin to resolve workspace package imports (relative paths to packages/)
const resolvePackages = {
  name: 'resolve-packages',
  setup(build) {
    // Match relative imports that reach into packages/
    build.onResolve({ filter: /\.\.\/.*packages\/core/ }, (args) => {
      const subpath = args.path.replace(/^.*packages\/core\/src\//, '')
      return { path: resolve(root, 'packages/core/src', subpath + '.ts') }
    })
  },
}

// Shared esbuild config. Both the API server (server/index.ts) and the BullMQ
// worker (server/worker.ts) bundle the same way and ship in the same image, so
// the production worker can run via `node dist/worker.cjs` (see Dockerfile /
// docker-compose.prod.yml) without dragging the TS toolchain into the runtime.
const sharedConfig = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  plugins: [resolvePackages],
  external: [
    // Node built-ins
    'node:*',
    'fs', 'path', 'os', 'crypto', 'http', 'https', 'net', 'tls',
    'stream', 'url', 'zlib', 'events', 'util', 'buffer', 'querystring',
    'child_process', 'cluster', 'dgram', 'dns', 'readline', 'string_decoder',
    'timers', 'tty', 'v8', 'vm', 'worker_threads', 'perf_hooks',
    'async_hooks', 'diagnostics_channel', 'inspector', 'trace_events',
    'assert', 'console',
    // npm packages — keep external (installed via npm install)
    'pg-native', 'bullmq', 'ioredis', 'pg',
    'puppeteer', 'sharp',
    'jsonwebtoken', 'express', 'compression', 'cors', 'helmet',
    'swagger-ui-express', 'yamljs', 'zod', 'dotenv', 'uuid',
    'dompurify', 'marked',
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
}

// API server (default container entrypoint).
await build({
  ...sharedConfig,
  entryPoints: [resolve(root, 'server/index.ts')],
  outfile: resolve(root, 'dist/server.cjs'),
})
console.log('✓ Server bundled to dist/server.cjs')

// BullMQ worker process (runs as a separate service from the same image).
await build({
  ...sharedConfig,
  entryPoints: [resolve(root, 'server/worker.ts')],
  outfile: resolve(root, 'dist/worker.cjs'),
})
console.log('✓ Worker bundled to dist/worker.cjs')
