# Cursor Agent 第四工位

Owner 於 2026-11-01 要求新增 Cursor Agent。沿用固定 Office 上游的 `cursor` provider、原生 PTY 與 workspace `.cursor/hooks.json`，不修改 vendor。四工位 MVP 的新真實任務條件是 AC-13；本輪完成接入前置與無憑證啟動，尚未完成登入後任務或四工位 UI。

## 固定安裝

在 lab 根目錄執行：

```sh
python3 scripts/cursor_cli.py install
python3 scripts/cursor_cli.py check
```

官方 CLI 有 `agent` 與 `cursor-agent` 名稱；Office 使用明確的 `cursor-agent` wrapper。固定官方版本 `2026.10.22-27dcf5f`，目前安裝入口只接受 macOS arm64。來源是 [Cursor 官方安裝入口](https://cursor.com/install) 公布的版本化下載 URL；[鎖檔](../tools/cursor/cli-lock.json) 保存下載 SHA-256 與完整 runtime tree 摘要。摘要是本輪官方 HTTPS 下載的固定值，並非供應商簽章。

只寫 lab 的 `tools/cursor/runtime/`，不改全域 PATH／安裝／憑證、不執行遠端 shell 安裝腳本。安裝前核對 archive 摘要，拒絕路徑逃逸、symlink、特殊檔案與重複 entries；每次使用前核對 runtime 摘要，版本或內容不符直接拒絕，沒有自動更新或 fallback。`install --archive /path/to/agent-cli-package.tar.gz` 可用預先下載的相同檔案。

`check` 在臨時 HOME、斷網 OS sandbox 下執行真實 `--version`／`--help`，不把符合版本當成登入或推論成功。設定只繼承必要終端環境，不繼承 key、endpoint、proxy、Node 注入、其他 provider 或 host switch 設定。依固定 CLI 支援的 `AGENT_CLI_CREDENTIAL_STORE=file`，避免使用系統憑證儲存；同時隔離 HOME 與 CURSOR_CONFIG_DIR，因 workspace hooks 與全域 hooks 不只由 CURSOR_CONFIG_DIR 控制。

## Owner 登入命令

安裝完成後，只需在自己的終端執行：

```sh
python3 scripts/cursor_cli.py login
```

程式執行固定原生 CLI 的 `login`，由終端顯示網址，請自行開啟並完成 Cursor 帳號登入。[官方登入說明](https://cursor.com/docs/cli/reference/authentication)。隔離資料存於忽略的 `.local/remote/cursor-home/`，使用檔案憑證模式與私有目錄／umask；不需要把金鑰、登入網址或 auth 檔傳給 agent。這個命令不送出模型任務；登入不等於授權付費驗收。

## 無推論啟動

```sh
python3 scripts/run_cursor_startup.py
python3 scripts/run_cursor_startup.py --check-startup
```

無旗標只列計畫。啟動檢查使用全新合成 workspace／HOME，故意不讀剛才的 owner 登入；因此預期結果仍是 `login_required`。使用原生 Office websocket 與 PTY，檢查實際「Press any key to log in」畫面及 `needs_input`，再停止並確認 Office hooks 已移除。不是只等秒數判定成功。

上游的 `--trust` 只信任本次合成 workspace，沒有 `--force`／`--yolo`／自動批准 MCP。wrapper 只接受精確 `--trust` argv，Office policy 禁止 prompt、終端輸入、resume、額外 worker、模型切換與其他 workspace。OS sandbox 阻擋 Cursor 的外部網路，啟動前實測外部 TCP 權限拒絕；保留 localhost／Unix sockets 供 Office 使用。最長 45 秒，關閉 Office 並清理本輪追蹤程序。不宣稱完整區外讀取或整棵 Office egress 審計通過。

2026-11-01 實測 12.51 秒，原生登入等待、workspace hooks 安裝／移除、外部 TCP 拒絕、5 個追蹤程序清理通過；31 項 Node 與 24 項 Python 測試通過，官方 archive 的實際提取／摘要也通過。[白名單證據](evidence/cursor-startup-2026-11-01.json)。

`status=completed` 僅指啟動檢查完成；`task_completed=false`、`session_hook_verified=false`、`model_inference_verified=false`。Cursor 的 session、模型、任務產物與取消／恢復仍待登入後的有界驗收。上游尚不能完整辨識 Cursor 工具權限等待，不把登入等待當作 AC-05 已完成。
