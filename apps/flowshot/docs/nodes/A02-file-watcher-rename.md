---
id: A02
title: 檔案 Watcher、事件序列化與 Rename
kind: auxiliary
milestone: M3
status: todo
depends_on: 
  - N02
  - N09
size: M
revision: 1
source_spec: ../../SPEC.md
source_version: 1.0.1
source_sha256: dd79293480f237ee9ff881f9b5a661d320cd65dfda66e70a256cd9309ac29b2e
contract_status: draft
legacy_reference: 
  - mdread notify watcher
  - loom rename-storm compensation
allowed_paths: 
  - src-tauri/src/watcher/**
  - src-tauri/src/events/**
  - crates/core/src/contracts/A02*
  - crates/db/src/repositories/documents*
  - src/features/watcher/**
  - contracts/locks/A02.json
  - docs/tasks/A02/**
  - docs/verification/A02.md
forbidden_paths: 
  - SPEC.md（除非本節點明確是治理變更）
---

# A02 — 檔案 Watcher、事件序列化與 Rename

## 目標

監聽 workspace 變更，將 atomic-save 事件風暴收斂為每文件序列事件，安全觸發重新 render/reanchor，並在證據唯一時遷移 rename。

## 輸入與前置條件

- N02 document identity/PathGuard。
- N09 revision transaction/reanchor。
- `SPEC.md` §7。

## 範圍與交付物

- start/stop workspace watcher。
- 500 ms quiet debounce、2 s max wait。
- canonical path coalescing。
- per-document single queue，跨 document 可並行。
- observed hash unchanged fast ignore；watcher 不覆寫 committed hash/revision，讀取不穩定時延後重試而非發布半成品事件。
- changed/missing/renamed/tree events。
- rename pair 優先；唯一 hash fallback 5 秒窗。
- ambiguity 不自動遷移。
- atomic save storm integration tests。
- UI 狀態提示與 reanchor summary。
- 建立 concurrency state-machine test；可附小型 TLA+ 模型但非硬 gate。

## Contract

新增：

```text
start_workspace_watch({ workspace_id })
stop_workspace_watch({ workspace_id })
```

事件 payload 依 `SPEC.md` §10.4。Event 只通知；UI 必須重新 query。

## 實作約束

- Watcher 不直接產生 canonical text。
- 同 document job 不並行。
- Revision conflict 必須重讀/重跑最新版本。
- Rename 只有唯一證據才更新同 document UUID。
- Missing 不刪 document/annotation。
- Symlink 忽略。
- Watcher shutdown 必須取消 task 並 flush 或安全丟棄未提交 job。

## BDD 場景

### 外部保存

**Given** 外部編輯器 atomic save 已開文件  
**When** 事件風暴結束  
**Then** 2 秒內 UI 刷新，只有一次穩定 reanchor commit。

### Git mv

**Given** 文件被 `git mv` 且 rename pair/唯一 hash 成立  
**When** watcher 收到事件  
**Then** 同一 document UUID 更新 rel_path，annotation 跟隨。

### Ambiguous copy

**Given** 同 hash 有兩個新候選  
**When** 舊文件 missing  
**Then** 不自動 rename，舊 document 保持 missing。

## 測試計畫

- Tempdir watcher integration：write、atomic rename、delete、restore、git-mv-like。
- Event coalesce deterministic tests。
- Per-document queue concurrency。
- Revision conflict retry。
- Ambiguous hash no-migrate。
- Shutdown cleanup。

## 驗收標準

- 三個 BDD 全過。
- 外部保存到 UI summary `< 2 s`。
- 無 duplicate/overwriting anchor event。
- Rename 誤遷移為 0。

## 性能與觀測

- 事件 storm 1000 events 不造成 1000 reanchor。
- 記錄 raw/coalesced/job counts 與 durations。

## 非範圍

- Remote filesystem。
- Symlink follow。
- 自動合併 ambiguous rename。

## 建議衍生任務

1. `T01-watcher-contract`
2. `T02-event-coalescer`
3. `T03-document-job-queue`
4. `T04-hash-and-missing-flow`
5. `T05-rename-resolution`
6. `T06-ui-events`
7. `T07-storm-concurrency-tests`

## Legacy 移植規則

可移植 legacy notify adapter 與 rename-storm測試案例；新 identity/revision規則必須重寫。


## 完成定義

除本節點特定驗收外，尚須同時符合：

- Contract lock 已建立且 drift check 為零。
- 測試先行證據已寫入 implementation plan 或 PR 描述。
- 本節點 BDD、unit/component/integration test 全綠。
- `make ci` 全綠。
- 無違反 `SPEC.md` INV-1～INV-8。
- `docs/verification/A02.md` 已附可重現命令與結果。
- `docs/metrics/node-outcomes.jsonl` 已追加結果。
- 沒有未記錄的規格偏差或未處理 blocker。

