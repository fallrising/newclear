# Loom reliability specification

審查基準：`fallrising/newclear` commit `82cd9d8159b31cdd852f333a219132dc614e5d66`，`apps/loom`，2026-10-03。
This document defines the maintenance acceptance criteria. Baseline findings below are not claims that repairs have landed. Frozen contracts and schemas remain unchanged.

## 完成度判斷

Loom 是已串接真實 PTY、文件編輯、canvas、AI provider adapter 的桌面原型，不能據此宣稱可靠產品或全功能完成。不以任意百分比代替功能與證據矩陣。

| 領域 | 已有能力 | 未完成／未證明 |
| --- | --- | --- |
| Contracts | Rust/TS 型別、origin invariant、fixtures；37 tests 通過 | 真實 AI IPC 另有 DTO，綠燈不代表 runtime wire format 一致 |
| 前端 | terminal/document/canvas，runnable block、Pin、命名 run_in、context edges | 35 個測試只有 parser 類；缺 lifecycle、保存競態、重啟整合證據 |
| 儲存 | Markdown 磁碟來源、canvas sidecar、terminal tombstone | SQLite store/recovery library 未接進桌面啟動；無法宣稱完整 session/history recovery |
| 檔案監看 | notify、echo guard、reconcile、hash conflict | rename echo、relative path、dirty reload／save race 問題 |
| AI | Anthropic/OpenAI/DeepSeek adapters、stream、context assembly | 未做 live provider 測試；UTF-8／SSE framing／提前 EOF 風險 |
| 後續設計 | MCP、capability gate、plugin、inbox | 未實作；不在本次可靠性修復範圍 |
| 自動化 | 元件內舊 CI 檔、局部單元／整合測試 | monorepo 根層沒有 Loom workflow；舊 workflow 主要驗 contracts |

## Documentation corrections

1. README 啟動命令改為現有 `npm run tauri -- dev`，補 `npm ci`、Rust 1.88 和平台 Tauri prerequisites。
2. README 的 Working build / all wired end-to-end 改成上述實際能力與證據；不要把歷史人工驗收當作本次通過。
3. C2/C3 acceptance 文件保留歷史快照標註，連到新的現況頁；不要抹除歷史或更改凍結 schema 來遷就實作。
4. 明確區分 sidecar 持久化與未接線 SQLite session history。`feeds_output_to` 繪製／儲存與實際 Run/Pin 流程亦需分列。
5. 記錄 runtime AI DTO 與 frozen contracts 的差異；本次先不變更凍結型別。

## Repair acceptance criteria

### P1：Canvas 保護

- 只有不存在的 sidecar 可初始化成空 canvas。
- 非 JSON、未知版本、錯誤 node/edge 結構必須產生可見讀取錯誤；不得自動覆寫原檔。凍結 v1 允許的 live terminal 與 document tombstone 目前也未完整支援，應唯讀保留，不能當成空 canvas。額外未知欄位不等於非法資料；若無法無損保存，需阻止覆寫並清楚提示。
- hydrate 成功後才允許 autosave；寫入失敗需可見且可重試。
- 保留 v1 凍結格式；若需要調整 schema，另走 contract RFC。
- 回歸測試覆蓋 missing、malformed、future version、invalid shape、合法 roundtrip 和阻止自動寫入。

### P1：文件與保存

- 文件 identity 在 IPC 邊界統一，使相對路徑開啟也接得到絕對路徑 watcher event。
- 非使用者的 reload 不產生 dirty；連續兩次外部修改均可正常重載。
- 保存只清除所保存版本的 dirty；等待 I/O 期間的新輸入必須維持未保存狀態，並串行化保存。
- 有 expected_hash 時，目標刪除視為 conflict，讀取 I/O failure 應回報；只有明確 create/overwrite 才可無 hash。
- Keep 只對使用者已確認的磁碟版本建立一次性覆寫意圖；其後若磁碟再變更，必須重新提示，toolbar 與快捷鍵一致。
- 建立缺失檔案只更新該文件，不得 reload 整個應用而丟失其他 dirty buffer。

### P1：文字串流

- PTY 和 AI 跨任何位元組切點仍完整保留合法 UTF-8；測中文、emoji、非法 UTF-8 與 EOF。
- SSE 必須支援 LF/CRLF、跨 chunk frame、多 data 行；沒有 provider 結束標記的 EOF 不得回報 Done。
- 前端在送出 AI 要求前建立識別／事件緩衝，早到的 Started/Error/Done 不得遺失。

### P2：監看與路徑

- 只忽略目標路徑與內容 hash 均符合的 self-write rename；真正外部 rename 不受影響。
- reconcile 不應在 echo TTL 失效後再次回報已知 self-created file；測試掃描間隔大於 TTL。
- 按已宣告不支援 symlink 的政策明確拒絕 symlink 路徑（含 `.loom`）。單次 canonicalize／preflight 檢查仍有 TOCTOU 限制，不能宣稱對敵對並行替換提供 race-safe confinement。

### P2：Canvas 與 AI lifecycle

- 鍵盤刪除 terminal 與 Close 共用 cleanup，不留下程序或 active route。
- 刪除 document 清除其 run_in map，不能重新合成懸空 edge。
- context 在送出時重新讀取；source 更新後 AI 請求使用最新內容。
- edge hydrate 保留／重建對應 handle，尺寸與 group 行為需符合文件。

## 驗證方式

先跑現有 suites，再以失敗回歸案例重現各項問題，修復後重跑；產品級完成仍需要實際 Tauri GUI smoke，包括重啟還原、外部編輯、Run/Pin 和多文件 dirty buffer 保護。靜態前端 build 不等同桌面驗收。

## Delivery and verification

Stages: documentation baseline; backend filesystem and stream correctness; frontend persistence/document lifecycle; integrated verification and CI. Each implementation stage needs failing regression evidence, passing focused checks, independent review, and a PR. No new MCP, plugin, gate, or production SQLite integration belongs to this maintenance scope.

Use `npm ci`, `npm test`, `npm run typecheck:contracts`, `npm run typecheck:app`, `npm run build`, and `cargo test --locked --workspace --no-fail-fast`. Generated `src/contracts` must remain unchanged. Baseline Rust core: 72 passed / 1 failed (self-save rename), contract tests 37 passed, frontend 35 passed. The sidecar audit harness rejected malformed/future/invalid-collection data in its expectations, and all three checks failed against baseline.

Automated checks are not desktop GUI acceptance or live provider validation. Record those separately. No completion percentage is inferred from passing test counts.

## Backend repair verification (2026-10-03)

The filesystem and streaming repair stage passes 140 Rust workspace tests: 37 contracts and 103 core/unit/integration tests. The original self-save rename failure now passes, as do delayed-reconcile, deleted-file conflict, descendant-symlink rejection, canonical document identity, split UTF-8, SSE framing/error/EOF/cancellation regressions. Provider tests use deterministic loopback HTTP; no live API calls were made.

The nonfrozen `doc_read` DTO adds absolute `path` for watcher identity. `doc_write` with an expected hash returns the existing conflict variant with empty `current_disk_hash` when the destination was deleted; other read failures return an I/O error. An absent expected hash remains explicit create/overwrite. Symlink checks are preflight checks below the canonical trusted root, not race-safe confinement. Optimistic hash checks are not cross-process compare-and-swap.
