import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { checkContract, sourceFiles, authorities } from './check-contract.mjs';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const paths = [...sourceFiles, ...authorities, 'contracts/locks/N03.json'];
for (const mutation of ['source', 'authority', 'schema', 'commands', 'extra', 'missing', 'source-list', 'digest', 'frozen']) {
  test(`real copied lock rejects ${mutation} tampering`, () => {
    const temp = mkdtempSync(join(tmpdir(), 'n03-contract-'));
    try {
      for (const p of paths) { mkdirSync(dirname(join(temp,p)), { recursive:true }); writeFileSync(join(temp,p), readFileSync(join(root,p))); }
      checkContract(temp);
      const lockPath = join(temp, 'contracts/locks/N03.json');
      const lock = JSON.parse(readFileSync(lockPath));
      if (mutation === 'source') writeFileSync(join(temp,sourceFiles[0]), '// drift');
      else if (mutation === 'authority') writeFileSync(join(temp,authorities[0]), '# drift');
      else {
        if (mutation === 'schema') lock.schemaVersion = 2;
        if (mutation === 'commands') lock.commandNames.push('invented');
        if (mutation === 'extra') lock.unexpected = true;
        if (mutation === 'missing') delete lock.node;
        if (mutation === 'source-list') lock.sourceFiles.pop();
        if (mutation === 'digest') lock.sourceHashes[sourceFiles[0]] = '0'.repeat(64);
        if (mutation === 'frozen') lock.frozenAt = 'tomorrow';
        writeFileSync(lockPath,JSON.stringify(lock));
      }
      assert.throws(() => checkContract(temp), /drift/);
    } finally { rmSync(temp, { recursive:true, force:true }); }
  });
}
