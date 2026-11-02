from pathlib import Path
import subprocess
root = Path(__file__).resolve().parents[2]
prefix = 'apps/cms-scaffold/'
def old(ref, path):
    return subprocess.check_output(['git', 'show', f'{ref}:{prefix}{path}'], cwd=root)
wave = 'docs/v2/waves/PP1c.md'
parent = 'docs/v2/contracts/PP1-recovery.md'
w = (root / wave).read_bytes()
p = (root / parent).read_bytes()
assert p.startswith(old('b0bf709f', parent))
assert w == old('24b851d6', wave).replace('**2026-11-01 窄幅修訂提案（DRAFT，待 owner 批准；不追溯改寫原批准或驗證）：**'.encode(), '**2026-11-02 窄幅修訂（owner 已批准；PR956 正常合併及遠端核對後生效，不追溯改寫歷史驗證）：**'.encode())
assert p == old('24b851d6', parent).replace('## 11 §4.2 restore receipt hash preimage 修訂提案'.encode(), '## 11 §4.2 restore receipt hash preimage 修訂'.encode()).replace('**2026-11-01 hash preimage 明訂提案（DRAFT，待 owner 批准）：**'.encode(), '**2026-11-02 hash preimage 明訂（owner 已批准；PR956 正常合併及遠端核對後生效）：**'.encode())
changed = subprocess.check_output(['git', 'diff', '--name-only', 'b0bf709f', '--', ':(top)' + prefix], cwd=root).decode().splitlines()
assert prefix + wave in changed and prefix + parent in changed, changed
assert all('/docs/v2/' in x or '/.team/' in x for x in changed), changed
untracked = subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard', '--full-name', '--', ':(top)' + prefix], cwd=root).decode().splitlines()
assert all('/.team/' in x for x in untracked), untracked
assert b'SHA256(canonicalBytes({version:1,files:Inventory.files}))' in p
print('PASS: parent prefix preserved; exact approved wave/receipt semantics unchanged; all card bytes unchanged; product source unchanged; complete media header preimage retained')
