---
id: N03
title: Deterministic Markdown Render Model
kind: core
milestone: M1
status: todo
depends_on: 
  - N00
size: M
revision: 1
source_spec: ../../SPEC.md
source_version: 1.0.1
source_sha256: dd79293480f237ee9ff881f9b5a661d320cd65dfda66e70a256cd9309ac29b2e
contract_status: draft
legacy_reference: 
  - mdread GFM/TOC/highlight reader UI
allowed_paths: 
  - src/lib/document-model/**
  - src/features/reader/**
  - fixtures/markdown/**
  - docs/tasks/N03/**
  - docs/verification/N03.md
  - contracts/locks/N03.json
forbidden_paths: 
  - SPEC.md（除非本節點明確是治理變更）
---

# N03 — Deterministic Markdown Render Model

## 目標

建立唯一、確定性的 Markdown render pipeline，一次產生 sanitized HTML、canonical text、TOC 與 source map，作為閱讀、選區、搜尋與重錨的共同語義基線。

## 輸入與前置條件

- N00 frontend/test pipeline。
- `SPEC.md` §4.2、§5、§11。
- 不依賴 N02；以 fixture source 開發。

## 範圍與交付物

- 實作純 TypeScript `buildDocumentModel(source)`。
- 支援 GFM：table、task list、strikethrough、autolink。Footnote 不列入 v1 gate。
- heading ID deterministic，重複 heading 以出現序穩定 suffix。
- TOC 由同一 AST 產生。
- code syntax highlight 使用本地 bundle；缺少 language 時安全降級。
- YAML/TOML front matter 識別後排除於 body/canonical text；不自動匯入 tag。
- raw HTML sanitize。
- 產生 canonical text 與 `TextSegment[]`。
- 將 segment metadata 放入 HTML，可由 DOM selection 反查。
- 產生 best-effort source byte/line map。
- 將標準 link/image 轉成受控 React adapter metadata；禁止 webview 直接載入 relative/remote asset。
- 建立 pipeline schema version = 1 與 canonicalization regression fixtures。

## Contract

本節點主要 contract 為 TypeScript 純型別，欄位必須與 `SPEC.md` §5.2 完全一致：

```ts
buildDocumentModel(source: string): DocumentModel
```

若新增 Rust DTO，只能用於 `DocumentModelSummary` 或 hash 驗證，不得在 Rust 再實作第二套 Markdown parser。

## 實作約束

- 同一 input 重跑必須 byte-identical。
- segment ID 禁止 random。
- canonicalization 規則只能由本模組實作。
- source map 可 best-effort，但 canonical range 不得依賴 source map。
- render time 不得因 source map 超過無 map baseline 的 2 倍。
- 禁止 remote syntax/theme/asset。
- `#heading`、local Markdown link、external URL、local image 必須走 `SPEC.md` §11.2 的受控行為。
- 私人 KB 不得提交；fixture 必須 synthetic/去識別。
- Pipeline 行為變動需 ADR，不得由 downstream node 任意改。

## BDD 場景

### 場景 1：確定性

**Given** 同一 Markdown fixture  
**When** 連續 build 100 次  
**Then** HTML、canonical text、hash、segments、TOC byte-identical。

### 場景 2：大型文件

**Given** 1 MiB、含 table/list/code/CJK 的 Markdown  
**When** build document model  
**Then** `< 300 ms`，TOC 與 segment range 有效。

### 場景 3：Raw HTML

**Given** source 含 script、event handler、dangerous URL  
**When** render  
**Then** 危險內容被移除，其餘文件正常呈現。

### 場景 4：Code whitespace

**Given** code block 含縮排與多空白  
**When** canonicalize  
**Then** code whitespace 保留；prose 空白按 §5.3 折疊。

## 測試計畫

- Canonicalization table test：CRLF、NBSP、soft/hard break、NFC、code block。
- Snapshot fixtures：CJK、emoji、combining marks、table、list、duplicate headings、raw HTML、MDX。
- Segment invariant：
  - ranges 單調、無越界。
  - canonical slice 與 DOM leaf text對應。
  - source range 若存在則有效。
- Determinism property。
- 1 MiB performance benchmark。
- sanitize security corpus。
- Link/image protocol tests：heading、relative Markdown、http/mailto、file/javascript、remote image、local image placeholder。

## 驗收標準

- 四個 BDD 場景全過。
- 3–5 個 synthetic representative fixture snapshot 入庫。
- `DocumentModel.schemaVersion=1`。
- Pipeline 產物足以支援 N05，不需重新解析 source。
- Reader 可呈現核心 GFM 並安全降級。

## 性能與觀測

- 記錄 parse/render/canonicalize/source-map 各階段 duration。
- 1 MiB `< 300 ms`。
- HTML 與 model size 記錄但不得記正文。

## 非範圍

- Annotation highlighter。
- Mermaid 圖形轉換（A06）。
- Wikilink resolution（A05）。
- Markdown 編輯或 source write-back。

## 建議衍生任務

1. `T01-document-model-types`
2. `T02-markdown-ast-pipeline`
3. `T03-canonicalizer`
4. `T04-segment-and-source-map`
5. `T05-sanitize-highlight-link-image-adapters`
6. `T06-reader-renderer`
7. `T07-fixtures-determinism-benchmark`

## Legacy 移植規則

可移植 legacy 的排版、TOC 與高亮樣式；render model、canonicalizer、segment/source map 必須按本節點新寫。


## 完成定義

除本節點特定驗收外，尚須同時符合：

- Contract lock 已建立且 drift check 為零。
- 測試先行證據已寫入 implementation plan 或 PR 描述。
- 本節點 BDD、unit/component/integration test 全綠。
- `make ci` 全綠。
- 無違反 `SPEC.md` INV-1～INV-8。
- `docs/verification/N03.md` 已附可重現命令與結果。
- `docs/metrics/node-outcomes.jsonl` 已追加結果。
- 沒有未記錄的規格偏差或未處理 blocker。

