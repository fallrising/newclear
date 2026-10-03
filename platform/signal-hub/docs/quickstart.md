# Quickstart — M1 本機事件中樞

M1 已提供本機 Go runtime、SQLite WAL、來源 token 授權、事件寫入／查詢與 Alertmanager v4 adapter。服務預設只監聽 `127.0.0.1:8080`。規則執行、投遞、UI、封存與部署尚未實作；完整範圍見 [runtime 契約](runtime.md) 與 [狀態](STATUS.md)。

以下步驟會在專案目錄的 `.local/` 建立合成 token、設定和資料庫；該目錄已加入 git ignore。請從 `platform/signal-hub` 執行，並使用 Go 1.26.8 或相容的 Go 1.26 工具鏈。

## 建置並建立本機設定

```sh
go build -o /tmp/signalhub ./cmd/signalhub
mkdir -p .local
```

用 Python 建立三個互不相同的 token 檔案和完整 M1 設定。權限由 `umask 077` 限制；token 不會印到終端機，也不會放進命令列參數。

```sh
python3 - <<'PY'
import json
import os
import secrets
from pathlib import Path

os.umask(0o077)
local = Path('.local').resolve()
local.mkdir(mode=0o700, exist_ok=True)
local.chmod(0o700)
for role in ('source', 'owner', 'readonly'):
    path = local / f'{role}.token'
    path.write_text(secrets.token_urlsafe(32), encoding='ascii')
    path.chmod(0o600)
config = {
    'sources': [{
        'name': 'demo',
        'source_prefix': 'urn:example:demo:',
        'allowed_types': ['demo.event.*'],
        'token_ref': f'file:{local / "source.token"}',
    }],
    'rules': [],
    'subscriptions': [],
    'webhook_allowlist': [],
}
(local / 'config.json').write_text(json.dumps(config, indent=2) + '\n', encoding='utf-8')
(local / 'config.json').chmod(0o600)
PY
```

## 啟動服務

```sh
/tmp/signalhub \
  --config .local/config.json \
  --db .local/events.db \
  --owner-token-ref "file:$(pwd)/.local/owner.token" \
  --readonly-token-ref "file:$(pwd)/.local/readonly.token"
```

保持此終端機開啟；`Ctrl-C` 會正常停止服務。預設只綁定 loopback。非 loopback 綁定僅接受明確的 Tailscale 位址，且此檢查本身不會驗證主機、ACL 或 tailnet 部署狀態。

## 寫入、重送並唯讀查詢

在另一個終端機，同樣從專案目錄執行以下 Python 範例。它從 token 檔讀取憑證，不會把 token 放進 shell 命令列；同一份事件送兩次後，預期收到 `202` 新增和 `200` 去重，再用唯讀 token 查詢事件。

```sh
python3 - <<'PY'
import json
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

base = 'http://127.0.0.1:8080'
local = Path('.local')
def token(role):
    return (local / f'{role}.token').read_text(encoding='ascii').strip()
def request(path, role, method='GET', body=None, content_type=None):
    headers = {'Authorization': 'Bearer ' + token(role)}
    if content_type:
        headers['Content-Type'] = content_type
    req = Request(base + path, data=body, headers=headers, method=method)
    try:
        with urlopen(req, timeout=3) as response:
            return response.status, response.read()
    except HTTPError as response:
        return response.code, response.read()

for attempt in range(30):
    try:
        with urlopen(base + '/readyz', timeout=1):
            break
    except Exception:
        if attempt == 29:
            raise
        time.sleep(0.2)

now = datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
event = {
    'specversion': '1.0',
    'id': 'demo-' + uuid.uuid4().hex,
    'source': 'urn:example:demo:service',
    'type': 'demo.event.created',
    'time': now,
    'subject': 'quickstart',
    'data': {'result': 'ok'},
}
body = json.dumps(event).encode()
for expected in (202, 200):
    status, response = request('/v1/events', 'source', 'POST', body, 'application/cloudevents+json')
    print(status, response.decode().strip())
    assert status == expected
status, response = request('/v1/events?limit=10', 'readonly')
assert status == 200
page = json.loads(response)
assert any(item['event']['id'] == event['id'] for item in page['items'])
print('readonly query: found', event['id'])
PY
```

如需確認資料庫可跨程序重啟保存事件，按 `Ctrl-C` 停止服務，再執行同一個啟動命令；重複上面的唯讀查詢即可看到先前事件。範例每次產生新的合成 ID，可重複測試。

## 驗證

先建立隔離的 Python 驗證環境；契約 checker 和 smoke test 共用這些依賴。

```sh
python3 -m venv /tmp/signalhub-checks
/tmp/signalhub-checks/bin/pip install --only-binary=:all: -r contracts/requirements.txt
```

接著執行 Go 測試、靜態檢查、建置、契約 checker 與本機端到端 smoke test：

```sh
go test -race ./...
go vet ./...
go build -o /tmp/signalhub ./cmd/signalhub
/tmp/signalhub-checks/bin/python contracts/check.py
/tmp/signalhub-checks/bin/python scripts/e2e_smoke.py --binary /tmp/signalhub
```

`e2e_smoke.py` 使用本機合成憑證及暫存資料庫執行 HTTP／SQLite smoke test，不會部署服務或連接外部系統。契約檢查驗證 schemas、fixtures、vectors 與 OpenAPI；它不取代 runtime 測試。
