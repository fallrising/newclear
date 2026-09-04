---
id: N02
title: Workspace、PathGuard 與 Lazy File Tree
kind: core
milestone: M1
status: todo
depends_on: 
  - N00
  - N01
size: M
revision: 1
source_spec: ../../SPEC.md
source_version: 1.0.1
source_sha256: dd79293480f237ee9ff881f9b5a661d320cd65dfda66e70a256cd9309ac29b2e
contract_status: draft
legacy_reference: 
  - mdread workspace, mtime cache, large-directory guard
allowed_paths: 
  - src-tauri/src/workspace/**
  - src-tauri/src/path_guard/**
  - crates/core/src/contracts/N02*
  - src/features/workspace/**
  - contracts/locks/N02.json
  - docs/tasks/N02/**
  - docs/verification/N02.md
forbidden_paths: 
  - SPEC.md（除非本節點明確是治理變更）
---

# N02 — Workspace、PathGuard 與 Lazy File Tree

## 目標

讓使用者安全加入本地根目錄，按需展開文件樹並開啟 Markdown；所有檔案存取由同一 PathGuard 保證 workspace 唯讀與不可逃逸。

## 輸入與前置條件

- N00 contract pipeline。
- `SPEC.md` §3、§7、§8、§11.1。
- M0 gate 已確認 N01 schema/repository 可用；不得以 mock 合併本節點。

## 範圍與交付物

- Workspace CRUD 的 v1 最小集合：list/create；不做永久 delete。
- 透過系統目錄選擇器加入 root；canonicalize 後保存。
- root detach：停止 watch/瀏覽但保留 document metadata。
- 拒絕同一 workspace 內 canonical path 相同或祖先/子孫重疊的 active roots。
- `PathGuard`：component validation、canonical containment、symlink reject、read-only open。
- `list_directory` 真 lazy、cursor pagination、extension filter、gitignore 規則；對 Markdown entry upsert identity 並回穩定 document UUID，但不讀正文。
- 目錄 entry 類型：directory、markdown_file、other_file、symlink。
- `open_document`：以 stable read（前後 metadata/file identity 檢查，最多重試 2 次）驗證 UTF-8、20 MiB limit，回傳 observed source hash 與 committed revision；只 upsert identity/mtime/size/last_seen，不推進 revision、不覆寫 committed hash。
- `resolve_local_document_link`：只解析 exact relative/root Markdown path，不做 basename 猜測；合法 `../` 經 source-relative 正規化後仍須位於同 root，回傳 document ID 與 fragment。
- `read_workspace_asset`：PathGuard 內讀取 PNG/JPEG/GIF/WebP，10 MiB limit；remote/data/SVG 拒絕。
- `list_recent_documents`。
- file tree UI：展開時才呼叫下一層；truncated/load-more 狀態。

## Contract

新增 command：

```text
list_workspaces({})
create_workspace({ name })
add_workspace_root({ workspace_id, selected_path, ext_filter?, ignore_rules? })
detach_workspace_root({ root_id })
list_directory({ root_id, rel_dir, cursor?, limit? })
open_document({ document_id })
resolve_local_document_link({ source_document_id, href })
read_workspace_asset({ source_document_id, href })
list_recent_documents({ workspace_id, cursor?, limit? })
```

`DirectoryPage` 必須含 `entries`, `next_cursor`, `truncated`。`OpenDocumentResponse` 必須含 document metadata、UTF-8 source、`observed_source_hash`、`committed_source_hash`、`committed_canonical_hash`、`committed_model_version`、revision。

## 實作約束

- Frontend 不得直接取得任意 filesystem capability。
- 禁止 string prefix sandbox。
- v1 不跟隨任何 symlink；顯示但不可展開/開啟。
- 圖片 command 只以 binary response/stream 回 MIME whitelist bytes；使用 magic bytes 驗證，不回任意 file URL。
- 直接 command `rel_path` 禁止 absolute、`..`、NUL、空 component；Markdown href 可含 `..`，但必須 URL-decode 一次、正規化後仍在 source root 內。
- 目錄列舉 deterministic：directory 先、file 後；同類按 Unicode display name 穩定排序。
- `.mdx` 不執行 JSX。
- root 內任何操作只讀。
- 大目錄不得一次讀取/渲染全部 entry。

## BDD 場景

### 場景 1：大型 workspace

**Given** root 下總計 5000 文件  
**When** 首次載入 file tree  
**Then** 只讀根層，`< 500 ms` 可互動，未展開子目錄不產生 IO。

### 場景 2：Traversal

**Given** `../x.md`、absolute path、NUL、encoded traversal 等請求  
**When** 任意 filesystem command 收到  
**Then** 回 `PATH_OUTSIDE_WORKSPACE` 或 validation error，不讀取目標。

### 場景 3：Symlink escape

**Given** root 內 symlink 指向 root 外  
**When** 使用者展開或開啟  
**Then** 顯示不可用並回 `SYMLINK_FORBIDDEN`。

### 場景 4：Root overlap

**Given** workspace 已有 `/kb` root  
**When** 嘗試加入 `/kb/subdir` 或同一 directory 的另一種 path 表示  
**Then** 拒絕並說明 active roots 不得重疊。

### 場景 5：Local asset

**Given** Markdown 引用 root 內 PNG 與 root 外/remote/SVG 圖片  
**When** reader 請求 asset  
**Then** 只有 root 內 whitelist 圖片可讀，其餘安全拒絕且不發網路請求。

### 場景 6：Ignore

**Given** ignore rules 含 `drafts/**`  
**When** 列出 tree 或 palette index  
**Then** drafts 不出現且不可由相對路徑繞過開啟。

## 測試計畫

- `core` 路徑 component validation table test。
- `src-tauri` tempfile integration：`../`、absolute、Unicode、symlink、race replacement。
- Gitignore semantics fixture。
- Root overlap/case-sensitivity platform tests。
- Directory pagination/cursor determinism。
- 5000 files benchmark。
- React component：未展開不 fetch、展開 fetch 一次、load more。
- `open_document`：UTF-8、non-UTF8、20 MiB limit、hash、讀取期間變更重試。
- Local link/asset：合法 parent-relative、escape traversal、double-encoding、remote、data URI、SVG、MIME spoof、10 MiB limit。

## 驗收標準

- 六個 BDD 場景全過。
- 所有 filesystem command 共用同一 PathGuard，不得複製判斷。
- 5000 文件首屏 `< 500 ms`。
- 未開啟文件不讀正文。
- root detach 後 annotation/document metadata 不刪除。

## 性能與觀測

- directory command 記錄 entry count、duration、truncated，不記完整絕對路徑。
- 讀檔記錄 bytes、duration、hash prefix。
- UI 可觀測 pending/error/retry。

## 非範圍

- 全文索引。
- 追蹤 symlink。
- 永久刪除 workspace/root。
- Watcher（A02）。

## 建議衍生任務

1. `T01-workspace-contracts`
2. `T02-path-guard`
3. `T03-root-lifecycle`
4. `T04-directory-pagination`
5. `T05-document-open-and-stable-read`
6. `T06-local-link-and-asset-commands`
7. `T07-tree-ui`
8. `T08-security-and-performance-verification`

## Legacy 移植規則

可移植 legacy 的 ignore、mtime cache、大目錄 UX；lazy loading、cursor、PathGuard 必須按本規格重寫。


## 完成定義

除本節點特定驗收外，尚須同時符合：

- Contract lock 已建立且 drift check 為零。
- 測試先行證據已寫入 implementation plan 或 PR 描述。
- 本節點 BDD、unit/component/integration test 全綠。
- `make ci` 全綠。
- 無違反 `SPEC.md` INV-1～INV-8。
- `docs/verification/N02.md` 已附可重現命令與結果。
- `docs/metrics/node-outcomes.jsonl` 已追加結果。
- 沒有未記錄的規格偏差或未處理 blocker。
