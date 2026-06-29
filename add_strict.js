import fs from 'fs'
import path from 'path'

const routesDir = path.join(process.cwd(), 'server', 'routes')
const files = fs.readdirSync(routesDir).filter((f) => f.endsWith('.ts'))

for (const file of files) {
  const filePath = path.join(routesDir, file)
  const content = fs.readFileSync(filePath, 'utf8')

  // Replace all z.object({...}) with z.object({...}).strict()
  // It is generally safer to just use a regular expression that matches `const XYZSchema = z.object({...})`
  // and captures everything up to the matching `})` and appends `.strict()`

  // We will find lines containing `const ... = z.object({`
  const lines = content.split('\n')
  let modified = false

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/const\s+\w+Schema\s*=\s*z\.object\s*\(\{/)) {
      let braceCount = (lines[i].match(/\{/g) || []).length - (lines[i].match(/\}/g) || []).length
      let j = i
      if (braceCount === 0) {
        if (
          lines[j].match(/\}\)/) &&
          !lines[j].includes('.strict()') &&
          !lines[j].includes('.passthrough()')
        ) {
          lines[j] = lines[j].replace(/\}\)/, '}).strict()')
          modified = true
        }
        continue
      }
      while (braceCount > 0 && j < lines.length - 1) {
        j++
        braceCount += (lines[j].match(/\{/g) || []).length - (lines[j].match(/\}/g) || []).length
      }
      if (braceCount === 0) {
        if (
          !lines[j].includes('.strict()') &&
          !lines[j].includes('.passthrough()') &&
          !lines[j].includes('.catchall(')
        ) {
          lines[j] = lines[j].replace(/\}\)/, '}).strict()')
          modified = true
        }
      }
    }
  }

  if (modified) {
    fs.writeFileSync(filePath, lines.join('\n'), 'utf8')
    console.log(`Updated ${file}`)
  }
}
