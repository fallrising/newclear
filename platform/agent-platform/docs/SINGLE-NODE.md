# 單節點操作手冊與隔離演練

本手冊提供單一 Linux 節點、單 operator 的 control plane 操作路徑：PostgreSQL、API、獨立 worker，以及由 API 同 origin 提供的 Web build。先以 fake/local mock 驗證操作流程；Cocoon/OpenHands 的真實 VM 啟用條件見下方。這一片不安裝或改動既有主機，M3/M4 整體仍 In progress。

## 版本與資料位置

固定一個已通過 CI 的 Git commit，記錄 `git rev-parse HEAD`。API、worker、migration 與 Web build 都使用同一版，升級時保留舊 checkout 與環境。

| 元件 | 本手冊基準 |
| --- | --- |
| Python | 3.12；`requirements.lock` 的完整 hashes |
| Web build | Node 24.18.0；`web/package-lock.json` |
| Database | PostgreSQL 18；`compose.m1.yml` 固定 18.6 image digest |
| 離線備份工具 | 安裝在執行 CLI 的主機、同 major 的 `pg_dump` 和 `pg_restore` 18 |
| Schema | migrations 001–016；備份工具另驗完整 catalog fingerprint |
| Runtime | 預設 fake；真 VM 另需 Linux/KVM、固定 guest、connector 與 sealed node |

以下命令均在 `platform/agent-platform` 目錄，以同一個非 root operator 執行。Docker 只用於自有 DB；產品 API/worker 不需要 Docker socket 或 `/dev/kvm`。正式私有設定放 repo 外，目錄 0700、檔案 0600；不要把密碼放 argv、終端歷史、Git 或 PR。DB volume、備份 bundle、connector journal/fences 與 private credentials 是不同資料，各有保存責任。

## 第一次啟動：loopback 模式

確認 55432/8000 未被占用；下例 Compose project 僅限新的專用安裝，不套用到別人的同名 project。

```bash
(
set -eu
python3.12 -m venv .venv
. .venv/bin/activate
python -m pip install --require-hashes -r requirements.lock
python -m pip install --no-deps -e .
npm --prefix web ci
npm --prefix web run build
pg_dump --version
pg_restore --version
)
```

`pg_dump/pg_restore` 是後面的維護前提；Compose 中有 server 不代表 CLI 主機已有 clients。安裝後確認兩者為 18，不能使用另一個 major 代替。

命令區塊以 subshell 的 `set -eu` 在錯誤時停止，避免失敗後沿用舊設定繼續操作。

建立一次性的私有環境檔。程式使用 exclusive create，已存在就停止，不覆寫既有密碼。DB password 是新隨機 URL-safe 字串；operator 登入密碼另設。

```bash
(
set -eu
. .venv/bin/activate
export AP_STATE="$HOME/.local/state/agent-platform"
unset DATABASE_URL
python - <<'PY'
import os, secrets
from pathlib import Path
root = Path(os.environ['AP_STATE'])
root.mkdir(parents=True, mode=0o700, exist_ok=True)
if root.is_symlink() or root.stat().st_uid != os.getuid() or root.stat().st_mode & 0o077:
    raise SystemExit('Require an operator-owned 0700 state directory')
password = secrets.token_urlsafe(32)
text = (
    f'POSTGRES_PASSWORD={password}\n'
    f'DATABASE_URL=postgresql://agent_platform:{password}@127.0.0.1:55432/agent_platform\n'
    'APP_ORIGIN=http://127.0.0.1:8000\nAPP_INSECURE_LOCAL=1\n'
    'CONNECTOR_ORIGIN=\nCONNECTOR_TOKEN_FILE=\nMODEL_PROXY_CONFIG=\n'
    'APP_EXPORT_TARGETS=[]\n'
)
fd = os.open(root / 'control.env', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as handle:
    handle.write(text)
PY
set -a
. "$AP_STATE/control.env"
set +a
docker compose --env-file "$AP_STATE/control.env" -f compose.m1.yml up -d --wait
agent-platform migrate
agent-platform bootstrap --username operator
)
```

Bootstrap 隱藏輸入、二次確認，密碼至少 12 字元；已有 operator 時拒絕覆寫。無公開註冊或預設帳號。非互動 bootstrap 可用 `--password-file` 指向私有 0600 檔，完成後依自己的秘密保存政策處理。

在兩個 terminal 使用同一目錄。Terminal A：

```bash
(
set -eu
. .venv/bin/activate
unset DATABASE_URL
set -a
. "$HOME/.local/state/agent-platform/control.env"
set +a
: "${DATABASE_URL:?Missing DATABASE_URL}"
exec agent-platform api --host 127.0.0.1 --port 8000 --web-dist web/dist
)
```

Terminal B：

```bash
(
set -eu
. .venv/bin/activate
unset DATABASE_URL
set -a
. "$HOME/.local/state/agent-platform/control.env"
set +a
: "${DATABASE_URL:?Missing DATABASE_URL}"
exec agent-platform worker
)
```

瀏覽器開 `http://127.0.0.1:8000`。建立 project（HTTPS repository metadata）、fake profile，以及包含下列內容的任務；base SHA 填完整 40/64 字元 revision。Fake 不會 clone 遠端 repository，這個 SHA 在此模式只是保存的 metadata。

```text
FILE rehearsal.txt
TEXT single-node check
```

成功判準：run 成功、UI 明示本機 mock／未開 VM、diff 包含 `rehearsal.txt`、成果封存可下載且 SHA-256 與顯示相符；專案測試未設定仍為 unknown。這不驗證一般自然語言 coding。

關閉瀏覽器再開、停止後重啟 API，應仍能看到同一 run/history/archive。終態任務重啟 worker 不應再分配或重送 prompt；需要新的嘗試時在 UI 明確 retry。活動任務意外重啟時由 lease/recovery 核對原身分，不能把手動刪 row 當成修復。

完成工作後，在兩個 terminal 用 Ctrl-C 停 API/worker，再停止 DB 並保留 volume：

```bash
docker compose --env-file "$HOME/.local/state/agent-platform/control.env" -f compose.m1.yml down
```

不要加 `-v`；它會刪除 DB volume。下一次沿用同一份私有設定、同一 Compose project/volume 啟動，已有 operator 不再 bootstrap。

這個流程需要兩個 terminal 保持執行。若以自己的 service manager 管理，API/worker 分開服務、使用同一非 root 帳號與絕對 WorkingDirectory/venv/web-dist、同一私有環境檔，DB ready 後才啟動；維護時先停服務及其 restart policy。此輪沒有安裝或驗收 systemd units、自動開機或 TLS reverse proxy。

## 存取與觀測

`APP_ORIGIN` 必須與瀏覽器完全一致（scheme/host/port、無尾斜線），mutation 同時需要 session CSRF。HTTP 只允許 explicit loopback opt-in；不要把 API bind 改成公開位址來繞過 origin/cookie 限制。

遠端單人使用可透過自己已設定的 SSH tunnel 把瀏覽器本機 8000 轉到節點 `127.0.0.1:8000`，仍使用相同 loopback origin。要公開 HTTPS 時另設受信任 TLS termination、精確 HTTPS `APP_ORIGIN`、關閉 `APP_INSECURE_LOCAL`，代理需保留 Origin/Host、轉送 cookie 並關閉 SSE buffering／配置長連線 timeout；API 仍 bind loopback，`proxy_headers=False` 不信任任意 forwarded header。TLS、憑證續期、SSH 與防火牆須在目標環境另驗，此次隔離演練沒有宣告它們已部署。

| 觀察 | 方法／判讀 |
| --- | --- |
| DB ready | `docker compose --env-file "$HOME/.local/state/agent-platform/control.env" -f compose.m1.yml ps`；health 只表示 PostgreSQL 接受連線 |
| HTTP/session endpoint liveness | `curl --fail --silent --output /dev/null http://127.0.0.1:8000/api/v1/session`；只驗 HTTP 回應，不把 cookie/CSRF 印到共享 log |
| 已登入的 DB 讀寫 | 登入後讀取任務清單／既有 run，再提交明確測試任務；分別核對查詢成功與持久化結果 |
| UI build | 根頁面及 `/assets/` 成功，與 API 同 commit；不要以 Vite dev server 代替 build 驗收 |
| Worker 活性 | 登入後觀察新測試任務的 queued→running→terminal、events 與 runtime occupied；API 可用不代表 worker 正常 |
| 資料持久性 | 重啟後同 run ID、event sequence、artifact SHA-256；費用仍 unknown |
| 容量／未知狀態 | UI runtime、run cleanup reason；unknown/interrupted 需對帳，不能直接釋放 reservation |

API 沒有獨立 `/health` 路由。未登入的 session probe 可只在記憶體產生 CSRF，DB 斷線時仍可能回 200；它沒有證明 DB、worker、connector 或 guest 正常。診斷 log 留在私有位置，不貼完整環境、DB URL、cookie、模型 payload 或 journal。

## 維護停寫、備份與空庫還原

1. 單 operator 停止提交新任務／retry/export，透過正常流程完成或取消所有工作，等待 cleanup 確認。Queued、interrupted、未完成 export/reconciliation 都不能跳過。
2. 停 API、普通／export workers 及其他 DB writers；真 runtime 還需核對原 connector/node 的 VM/claim/程序停止證據，保留 journal/fences。停止 service manager 的自動重啟。
3. 只切換 admission flag：在已載入正確 `DATABASE_URL` 的私有 operator terminal 執行下列命令。它不取消、刪除或宣告任何 VM 已停止。

```bash
(
set -eu
. .venv/bin/activate
export AP_STATE="$HOME/.local/state/agent-platform"
unset DATABASE_URL
set -a
. "$AP_STATE/control.env"
set +a
: "${DATABASE_URL:?Missing DATABASE_URL}"
python - <<'PY'
import os, psycopg
with psycopg.connect(os.environ['DATABASE_URL']) as conn:
    conn.execute('UPDATE runtime_capacity SET draining=true')
PY
agent-platform backup-create --directory "$AP_STATE/backup-new" --offline
agent-platform backup-verify --directory "$AP_STATE/backup-new"
)
```

Bundle 必須是尚不存在的目錄，直接 parent 必須 operator-owned 0700，祖先不可不安全可寫。每次換新的名稱。`--offline` 是操作者確認，工具仍重驗 terminal jobs、bindings、reservations、exports 與 schema。若拒絕，保存現況並查原因，不能手改 lifecycle facts 讓檢查通過。

備份含 DB-resident archives/history；不含 sessions、短效 tokens、maintenance identity、角色／tablespaces、private credential files、connector journal/fences 或 VM state。另保存相容的 source commit、鎖檔、映像識別與私有操作資料。完成 bundle 應複製到受控的另一儲存位置並再 verify；同磁碟副本不能防主機損壞。雜湊驗損毀，不驗來源真偽，只還原自己信任的 dump。

還原時保留原 DB，另外建立一個真正空的 PostgreSQL18 database（不可先 `migrate`），由 operator role 擁有；不要用原名或 restore 覆蓋原庫。將另一份私有環境檔的 `DATABASE_URL` 指向新 DB，確認 hostname、port、database identity 後，在保持 writers 停止的 terminal：

```bash
(
set -eu
. .venv/bin/activate
export AP_STATE="$HOME/.local/state/agent-platform"
# 先載入已檢查、指向新空庫的私有環境檔；不得把 URL 印出
unset DATABASE_URL
set -a
. "$AP_STATE/restore.env"
set +a
: "${DATABASE_URL:?Missing DATABASE_URL}"
agent-platform backup-restore --directory "$AP_STATE/backup-new" \
  --offline --confirm-database agent_platform_restored
)
```

`--confirm-database` 必須正好等於新 DB 名稱。拒絕非空庫、schema/major 不符或損壞 bundle；失敗的 target 不可當作可用結果。成功後 runtime 仍全部 drain，舊 session 失效；用原 operator 密碼重新登入，核對 run/history/archive bytes/hash。還原不自動 replay export、恢復 VM 或配置秘密。

先只啟動指向新 DB 的 API：沿用 Terminal A 命令，但將載入的 `control.env` 改成已核對的 `restore.env`；驗證內容，再決定恢復 admission。Fake-only、已確認沒有真 runtime 的安裝，可明確解除 fake 節點的 drain：

```bash
(
set -eu
. .venv/bin/activate
unset DATABASE_URL
set -a
. "$HOME/.local/state/agent-platform/restore.env"
set +a
: "${DATABASE_URL:?Missing DATABASE_URL}"
python - <<'PY'
import os, psycopg
with psycopg.connect(os.environ['DATABASE_URL']) as conn:
    conn.execute("UPDATE runtime_capacity SET draining=false WHERE node_id='fake-local'")
PY
)
```

之後才啟動指向新 DB 的 worker（Terminal B 也改載入 `restore.env`）。真 runtime 不能照這段 SQL 解除；先依其 journal/fences、固定版 node/connector 與 [M2 登錄流程](M2.md) 完整對帳，`register-runtime` 的解除 drain 是一個明確操作。DB restore 不能替代 VM recovery。

保留清理另見 [BACKUP-RETENTION.md](BACKUP-RETENTION.md)：預覽、檢查固定候選及 digest、明確批准；本手冊不新增排程。不刪事件、審計或原始 diff，已 prune 的 archive 不會靠重啟復活。

## 升級、回滾與故障排查

升級依序：記錄現行 revision/設定→完成工作並停寫/drain→用**舊版支援工具**保存可驗證備份→準備新 checkout/locked dependencies/Web build→核對 migration 相容性→`agent-platform migrate`→同版 API/worker→登入／新 mock task／archive／重啟檢查。新備份工具只認自己的 schema，不可先升級工具再假定它能備份任意舊 DB。

回滾先停新版本所有 writers，保留失敗 DB/log，不直接 downgrade schema。若沒有 DB migration，仍先確認資料相容性才回舊 binaries；若 schema 已變，使用舊版工具將升級前 bundle 還原到**另一個空 DB**，驗證後才切換同版服務。這會失去備份之後的新資料，需先決定取捨；不把切換當成無損線上 rollback。

| 現象 | 優先核對 |
| --- | --- |
| 登入／mutation 403 | 精確 origin、HTTP loopback flag、CSRF、瀏覽器是否保留舊 cookie；不要關閉檢查 |
| API 503 | 專用 DB health、私有設定、migration／連線；不要把 URL 貼到 log |
| 任務一直 queued | worker 是否存活、draining、四 slot 容量、profile/runtime 是否匹配 |
| interrupted／cleanup unknown | 讀原 run/lease/binding reason，依 [recovery](M3-RECOVERY.md)；保留 reservation/journal |
| 備份拒絕 | 未結束工作／writers、未知 cleanup、未 drain、schema/client major、目錄權限 |
| 還原拒絕 | 新 target 是否真正空、確認名稱、trusted bundle/hash、server major；勿加 clean/drop 繞過 |
| 封存下載 410 | 已保留期限清理的 tombstone；摘要／原 diff 仍保留，不能當作 bytes 已備份成功 |

## 真 Cocoon/OpenHands 的額外前提

按 [KVM-HOST](KVM-HOST.md)、[M2](M2.md)、[guest isolation](M3-GUEST-ISOLATION.md)、[sealed egress](M3-EGRESS.md) 和 [正常 Worker 驗收](WORKER-TOOLS-KVM.md) 固定 runtime／guest／launcher、非 root 身分、zero-warm node、唯讀 repository bundle、policy digest 與停止證據。Connector/node/模型與工具 proxy 是額外服務，不能只設定 `CONNECTOR_ORIGIN` 就假定完整啟用。API 不取得 node credential；private files 與短效 run token 不混用。

現行模型維持 mock，billing/hard money limit 延後。GitHub export 預設 `APP_EXPORT_TARGETS=[]` 且不啟動 export-worker；啟用前另走 [GITHUB-EXPORT](GITHUB-EXPORT.md) 的私有配置與逐次明確授權。本次沒有讀取真 key、呼叫真 provider/export 或啟動 KVM。

## 可重跑的隔離演練

先完成依賴安裝和 Web build，預先取得固定的 PostgreSQL image；演練入口本身只使用本機已有映像，不自動下載：

```bash
docker pull postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873
make deployment-rehearsal
# 明確納入已 build 的靜態 UI；完整瀏覽器操作另由 browser-test 驗證
python scripts/single-node-rehearsal.py --web-dist web/dist
```

演練一律建立新、帶 ownership label 的 PostgreSQL 容器與合成資料，忽略 ambient database/connector/model/export 設定；不接受現有 operator DB。驗證 CLI migrate/bootstrap、真 TCP API/session/CSRF/task、獨立 worker、FILE/TEXT 成果與 archive、程序重啟持久性、不重送 prompt、停寫/drain/native backup/verify/空庫 restore、舊 session 拒絕／重新登入／相同成果、fresh maintenance identity 與 runtime 仍 drain。正常完成或可處理的錯誤會收回自己建立的程序／資料庫／容器，失敗回非零。Wrapper 將可處理的中斷傳給 runner，讓其執行 ownership-checked cleanup；若程序無回應而必須 SIGKILL，回報 `rehearsal_cleanup_incomplete`，不能宣告已清理。不可處理的 hard kill／主機失效也不保證自動清理，需依原始自有資源身分對帳，不做廣泛 label 刪除。

`--directory PATH` 可保留私有 log／JSON evidence，PATH 必須是既有安全私有 parent 下尚不存在的新目錄。預設使用暫存目錄，結束後移除，只輸出有界 JSON 結果；需要診斷紀錄時應明確指定新目錄。

備份測試使用 `backup_fixture.NativeClient` 將 native-tool 呼叫傳入自有 PostgreSQL18 client container，實際執行 `pg_dump`/`pg_restore`；這是測試 transport seam，沒有把 fake dump 當成證據。一般產品 CLI 仍需主機安裝 PostgreSQL18 clients。無 `--web-dist` 時使用最小靜態頁 fixture；它沒有驗證 React 互動。完整驗證命令與實際結果保存於 [single-node evidence](evidence/single-node.json)，不以這個演練宣告 TLS/systemd/KVM/整體 MVP 或 release 完成。
