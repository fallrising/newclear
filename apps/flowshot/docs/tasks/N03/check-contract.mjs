import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
const defaultRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const sourceFiles = ['src/lib/document-model/index.ts', 'src/lib/document-model/types.ts'];
export const authorities = ['SPEC.md', 'docs/nodes/N03-markdown-render-model.md', 'docs/adr/ADR-002-document-model-v1.md'];
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function checkContract(root = defaultRoot) {
  const read = path => readFileSync(resolve(root, path));
  const lock = JSON.parse(read('contracts/locks/N03.json'));
  const expected = {
    node: 'N03', schemaVersion: 1, contractKind: 'pure-typescript',
    commandNames: [], frozenAt: '2026-10-23T03:18:15Z',
    sourceFiles, sourceHashes: Object.fromEntries(sourceFiles.map(p => [p, digest(read(p))])),
    authorityHashes: Object.fromEntries(authorities.map(p => [p, digest(read(p))])),
  };
  if (!isDeepStrictEqual(lock, expected)) throw new Error('N03 contract source or metadata drift');
  return lock;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkContract(process.argv[2]); console.log('N03 frozen TypeScript contract: passed');
}
