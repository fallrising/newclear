import { readdir, readFile, access } from 'node:fs/promises'
import { resolve, relative, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { evidenceRecordOk, journalPointerOk } from './evidence-pointer.mjs'

const component = resolve(import.meta.dirname, '..')
const root = resolve(component, '../..')
async function markdown(directory) {
  const files = []
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'benchmark-results', '.git'].includes(item.name) || /^(test-results|playwright-report)(-|$)/.test(item.name)) continue
    const path = resolve(directory, item.name)
    if (item.isDirectory()) files.push(...await markdown(path))
    else if (item.name.endsWith('.md')) files.push(path)
  }
  return files
}
const files = await markdown(component)
const failures = []
let count = 0
let pointers = 0
const pointerRecord = JSON.parse(await readFile(resolve(component, 'docs/evidence-pointer.json'), 'utf8'))
if (!evidenceRecordOk(pointerRecord)) failures.push('docs/evidence-pointer.json is not a journal evidence pointer')
for (const file of files) {
  const content = await readFile(file, 'utf8')
  if ((content.match(/^```/gm) ?? []).length % 2) failures.push(`${relative(root, file)}: unclosed code fence`)
  const text = content.replace(/^```[^\n]*\n[\s\S]*?^```/gm, '')
  for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const link = match[1].split(/\s+"/)[0]
    if (link.startsWith('archive/team-ledgers/')) {
      pointers++
      if (!journalPointerOk(link)) failures.push(`${relative(root, file)}: malformed evidence pointer ${link}`)
      continue
    }
    if (/^(?:[a-z][a-z\d+.-]*:|#)/i.test(link)) continue
    const pathOnly = link.split('#')[0]
    const target = resolve(dirname(file), decodeURIComponent(pathOnly))
    if (!target.startsWith(`${root}/`)) { failures.push(`${file}: link escapes repository: ${link}`); continue }
    const repoPath = relative(root, target)
    if (repoPath === '.team' || repoPath.startsWith('.team/')) continue
    count++
    try { await access(target) } catch {
      try { execFileSync('git', ['cat-file', '-e', `HEAD:${repoPath}`], { cwd: root, stdio: 'ignore' }) }
      catch { failures.push(`${relative(root, file)}: missing ${link}`) }
    }
  }
}
if (failures.length) { console.error(failures.join('\n')); process.exit(1) }
console.log(`Documentation gate passed: ${files.length} Markdown files, ${count} repository links, ${pointers} journal pointers.`)
