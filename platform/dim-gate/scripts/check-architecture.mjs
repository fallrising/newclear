import { readdir, readFile } from 'node:fs/promises'
import { extname, relative, resolve, dirname, sep } from 'node:path'

const root = resolve(new URL('../src', import.meta.url).pathname)
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx'])

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(entry => entry.isDirectory()
    ? files(resolve(directory, entry.name))
    : sourceExtensions.has(extname(entry.name)) ? [resolve(directory, entry.name)] : []))
  return nested.flat()
}

const violations = []
for (const file of await files(root)) {
  const text = await readFile(file, 'utf8')
  for (const match of text.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)) {
    const specifier = match[1]
    if (!specifier.startsWith('.')) continue
    const target = resolve(dirname(file), specifier)
    const sourceParts = relative(root, file).split(sep)
    const targetParts = relative(root, target).split(sep)
    if (targetParts[0] !== 'features' || targetParts.length < 3) continue
    const sourceFeature = sourceParts[0] === 'features' ? sourceParts[1] : null
    const targetFeature = targetParts[1]
    if (sourceFeature !== targetFeature) {
      violations.push(`${relative(root, file)} imports private feature path ${specifier}; import features/${targetFeature}/index.ts instead`)
    }
  }
}

if (violations.length) throw new Error(`Feature boundary violations:\n${violations.join('\n')}`)
console.log('Feature import boundaries passed.')
