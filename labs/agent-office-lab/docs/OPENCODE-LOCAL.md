# OpenCode + Strata + Office

> 公開匯入版：先依 [SETUP](SETUP.md) 設定環境（research 文件請見 ../docs/SETUP.md）。原 runs 的連結改指向歷史摘要，原始日誌及截圖不公開。

2026-10-31：**Office 的真實 OpenCode 工位已完成本地合成任務（AC-02）**，並驗證同一 session 的後續任務、取消、持續開啟與關閉清理。Grok／Pi 的接入仍未完成。

## 安裝後執行

從元件目錄啟動本地 demo，完成合成驗證後保持開啟：

```sh
"$STRATA_HOME/source/.venv/bin/python" scripts/run_local_work.py --harness office-opencode --keep-open
```

終端會顯示本次 localhost 網址與一次性登入連結。登入後在 lite 工位開啟終端、接續交付任務。Ctrl+C 關閉 Office、OpenCode、Strata 與資源監控。啟動過程通常約一分鐘；實際時間依硬體／檔案快取而異。

每次建立新的合成 workspace，保存在 `runs/local-work-*/workspace/`，不讀私人專案。此 demo 只支援這個 workspace，不支援額外 repo／worktree；請勿透過上游 3D 入口增加其他專案。該 demo floor 的 provider 清單及 spawn 入口限制為 OpenCode＋本地模型，最大一個 worker。其他上游功能尚未整理成三工位 MVP。

只執行驗收、完成後自動關閉：

```sh
"$STRATA_HOME/source/.venv/bin/python" scripts/run_local_work.py --harness office-opencode
```

加上 `--check-cancel` 會在第一個任務完成後，要求同一工位執行 `sleep 120`，確認它真的開始後透過 Office 取消，核對程序退出。`--harness opencode` 則只測 CLI，略過 Office。

## 實際結果

| 檢查 | 證據 |
|---|---|
| OpenCode CLI 直接接 Strata | [result（歷史摘要）](evidence/README.md)，40.96 秒、232 output tokens、檔案正確 |
| Office 原生 PTY＋插件 | [result（歷史摘要）](evidence/README.md)，52.95 秒；工位 `idle → working → done`，session ID、229 output tokens、產物 hash |
| 實際完成的工位畫面 | [office-opencode.png（歷史摘要）](evidence/README.md) |
| 後續任務取消、保持開啟與關閉 | [result（歷史摘要）](evidence/README.md)：第一個任務通過；第二個任務取消通知 202 ms，兩個所屬程序均退出；最後人工中斷 demo，頂層狀態 `stopped`、cleanup 無錯誤 |
| OpenCode 子程序邊界 | [result（歷史摘要）](evidence/README.md)：localhost／workspace 寫入允許；非 localhost 連線與目錄外寫入被拒；Strata 關閉時 wrapper 直接失敗 |
| Demo provider 限制 | [tests（歷史摘要）](evidence/README.md)，5／5 通過：阻擋雲端 provider、shell worker、其他 model／worktree／repo，保留本地呼叫參數 |

取消使用實際工位 PID 的程序樹作為開始／結束證據，沒有以固定等待時間猜成功。`office-events.jsonl` 是原生事件；不是 mock card 或自製成功訊號。Token usage 由 OpenCode 插件回報，另有 Strata engine log 可核對。

## 版本與接法

- CLI：`opencode-ai@1.19.5`，macOS arm64 binary；[package](../tools/opencode/package.json)／[lock](../tools/opencode/package-lock.json)。未全域安裝，使用 npm 的固定版本 optional binary，沒有跑 postinstall。
- Plugin SDK：`@opencode-ai/plugin@1.19.5`，[lock](../tools/opencode-plugin/package-lock.json)。安裝時 `ini` dependency 有 Node engine warning；此機實際 CLI 使用 Bun 1.4.4，原生插件任務已通過。
- [模型設定](../configs/opencode-strata-local.json)：主模型、小模型都指向 `strata/qwen3.8-flash-next-q2_0`，只啟用 strata provider，32K context、4K output cap，Chat Completions endpoint `127.0.0.1:8080/v1`。
- [launcher](../scripts/bin/opencode)：Office 依 basename 識別為 OpenCode，保留原生 PTY、`--prompt`、session 及 hooks。先檢查本機 Strata 型號與 context；不可用即失敗。
- [runtime](../scripts/local_opencode.py)：每次獨立 XDG 資料／設定目錄，只傳必要環境與原生 hook token，不複製 provider 憑證。只載入該 workspace 的 Office status plugin；這個 demo 不載入 Office 的多 agent MCP 工具。

自訂 provider 與 allowlist 依 [OpenCode providers](https://opencode.ai/docs/providers/) 和 [configuration](https://opencode.ai/docs/config/)；停用更新、外部 skills、模型目錄下載等環境變數依 [CLI 文件](https://opencode.ai/docs/cli/)。實際以已安裝的 1.19.5 行為驗證，不假定線上 OpenCode 2 的設定也適用。

## 保留的失敗與修正

1. [首次 Office 啟動（歷史摘要）](evidence/README.md) 停在 plugin dependencies：CLI 的獨立檔案模式可運行，但載入插件會等待 SDK 依賴初始化。改成在安裝階段下載 SDK／lock，再複製到每個 run 的 config 目錄，執行時繼續拒絕外部網路。依據：[1.19.5 config](https://github.com/anomalyco/opencode/blob/v1.19.5/packages/opencode/src/config/config.ts)、[npm 初始化](https://github.com/anomalyco/opencode/blob/v1.19.5/packages/core/src/npm.ts)。
2. [首次取消驗收（歷史摘要）](evidence/README.md) 等待 `activity=bash` 超時；本地命令其實已開始，工具名稱事件不足以作同步依據。保留整體 failed，改查實際 owned process tree 後成功。沒有把該失敗 run 改寫成通過。

## 隔離範圍

OpenCode 與其 shell 工具繼承 macOS sandbox：網路只允許 loopback／本機 Unix sockets，檔案寫入限該 run state、合成 workspace 與必要 `/dev`。模型設定也只有本地 provider。工具允許自動讀寫該合成任務，沒有取消整體 sandbox。

此 profile 的非本地網路拒絕及寫入邊界已做 probe；**沒有把 Office host／Strata／整台主機宣稱為完全離線隔離**。區外檔案的讀取仍未嚴格隔離，`strict_network_isolation_verified=false`。這個階段只使用合成資料。

邊界檢查（先停止 Strata）：

```sh
"$STRATA_HOME/source/.venv/bin/python" scripts/check_opencode_sandbox.py
```
