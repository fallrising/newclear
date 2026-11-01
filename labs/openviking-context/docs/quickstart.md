# 本機試用

## 已驗證的離線入口

Python 3.10+，無第三方依賴、無網路、無模型費用。在本項目目錄執行：

```bash
make check
python3 context_lab.py demo --query 'backup retention'
python3 context_lab.py demo --query 'backup retention' --max-bytes 512
```

第一個 demo 應帶回 backup.md 的來源、revision、SHA-256 與全文；第二個因 budget 太小略去整筆。這是 lexical fixture，不是已啟動的 OpenViking。

## Live 路徑（skipped：尚未選定 provider／憑證，未啟動 server）

以下是依固定 release 原始碼／官方文件編寫的待驗收操作包。先決定 embedding 與 VLM 的 provider、模型、向量維度及可接受費用；可在本機用相容 Ollama，也可用已核准的 API。`doctor`、seed/index 與 search 都可能呼叫模型；不要把健康檢查成功當成零費用或完整可用。

1. 建立隔離安裝及設定位置。不要共用既有 OpenViking workspace。

```bash
umask 077
mkdir -p .local
python3 -m venv .local/server-venv
.local/server-venv/bin/pip install -r requirements-server.txt
export OPENVIKING_CONFIG_FILE="$PWD/.local/ov.conf"
.local/server-venv/bin/openviking-server init
```

`init` 依提示選模型與認證；若詢問自動啟動，先拒絕並檢查設定。此方式固定 top-level 0.4.23，transitive dependencies 未鎖死；live evidence 必須保存 `pip freeze` 的本地結果。不要安裝上游的全域 agent memory hooks。

2. 在生成的 ov.conf 核對：`server.host=127.0.0.1`、`server.with_bot=false`、`server.auth_mode=api_key`、非空且本地生成的 `server.root_api_key`、`storage.workspace` 指向本 lab `.local/data` 的**絕對路徑**、`memory.session_auto_commit.enabled=false`。保留 wizard 生成的 embedding/VLM 設定；`chmod 600 .local/ov.conf`。不要將金鑰提交或貼進 PR。

```bash
.local/server-venv/bin/openviking-server doctor
.local/server-venv/bin/openviking-server --config .local/ov.conf --host 127.0.0.1
```

在另一終端 `curl http://127.0.0.1:1933/health`。用 `http://127.0.0.1:1933/studio` 的管理入口，以 root key 建立專用測試 account 與 `lab-user`。取得 User/Admin **data key**；root key 不能用於一般 tenant data API。Account/USER 建立步驟以 [固定版 authentication](https://github.com/volcengine/OpenViking/blob/df32bf6e50a40843438f9491a26069ca4bd08f1f/docs/en/guides/04-authentication.md) 與 [Admin API](https://github.com/volcengine/OpenViking/blob/df32bf6e50a40843438f9491a26069ca4bd08f1f/docs/en/api/08-admin.md) 為準。

3. 用本機編輯器把 data key 保存至 `.local/user.key`，只有該 key 的文字，`chmod 600 .local/user.key`。先在 private user scope 試跑，以下 `lab-user` 必須與該 key 的身份一致。

```bash
python3 context_lab.py seed --key-file .local/user.key --timeout 150 --scope viking://user/lab-user/resources/context-lab
python3 context_lab.py query --key-file .local/user.key --scope viking://user/lab-user/resources/context-lab --query 'backup retention'
```

seed 只匯入兩份公開合成 fixture。成功須 `vector_status`、`semantic_status` 都 complete 且回讀 hash 相符；這仍不保證所有 parent summaries 新鮮，query 是另一個 gate。若 timeout／queued／skipped，先檢查服務端 tasks／日誌；重跑 seed 只對帳已存在的 bytes，不會修復 index 或重放未知寫入。必要時由 operator 明確 reindex 該專用 subtree，再 query；不要藉由放寬 hash 或 URI 驗證通過測試。

第二個獨立終端用相同身份查詢，可驗證跨 process/session 共享；切換到 account shared resources 前，先完成 restricted ACL 與不同 user 的正／負向測試。同一 data key 不代表多 user。

## 停止、保留與恢復

server 在前景用 Ctrl-C 停止；`.local/data` 保留，不提供自動清空或刪除命令。重新啟動同一 config/workspace 後，再查 fixture 與 hash。需要移除時先確認這是本 lab 的專用資料。

Snapshot 與 OVPack 不等於完整災難復原：snapshot 不保存歷史 ACL／向量；OVPack 不包含 account/key registry，且匯出是明文。正式使用前應在空白環境還原 corpus、registry、config、獨立保管的 key，重新索引並測身份與撤銷。

## Live 結果回填

記錄 server release/commit、Python/OS/CPU、模型與維度（不記 key）、corpus hash、seed/query 的處理狀態與延遲、命中來源、request/token 費用、重啟後結果。`401/403` 查 data key 與身份；`404` 查 scope；無命中查索引任務；checksum mismatch 查 content/revision，不能靜默接納舊內容。
