---
id: N00
title: 專案骨架、CI 與 Contract Pipeline
kind: core
milestone: M0
status: blocked
depends_on: []
size: M
revision: 1
source_spec: ../../SPEC.md
source_version: 1.0.1
source_sha256: dd79293480f237ee9ff881f9b5a661d320cd65dfda66e70a256cd9309ac29b2e
contract_status: draft
legacy_reference: 
  - mdread repository layout
  - loom contract-first CI pattern
allowed_paths: 
  - Cargo.toml
  - Cargo.lock
  - crates/core/**
  - crates/db/**
  - crates/xtask/**
  - src-tauri/**
  - src/**
  - Makefile
  - README.md
  - .gitignore
  - index.html
  - package.json
  - package-lock.json
  - tsconfig*.json
  - vite.config.ts
  - vitest.config.ts
  - eslint.config.js
  - .github/**
  - contracts/**
  - docs/tasks/N00/**
  - docs/verification/N00.md
  - docs/metrics/node-outcomes.jsonl
  - docs/graph.yaml
forbidden_paths: 
  - SPEC.md（除非本節點明確是治理變更）
---

# N00 — 專案骨架、CI 與 Contract Pipeline

## 目標

建立可重現的 Tauri 2 + React 19 工程骨架，讓後續每個節點都有一致的編譯、測試、contract generation、dependency boundary 與 CI gate。

## 輸入與前置條件

- `SPEC.md` §4、§10、§12。
- 開發機已具 Rust stable、Node LTS、Tauri 所需平台依賴。
- 本節點無功能 dependency。

## 範圍與交付物

- 建立 Tauri 2 + React 19 + TypeScript + Vite 空應用。
- 建立 Rust workspace：`crates/core`、`crates/db`、`crates/xtask` 與 `src-tauri`。
- 建立 `core::contracts` 基礎 trait/型別與 `xtask contracts`。
- 生成 TypeScript DTO、typed invoke wrapper、command manifest。
- 建立 `make bootstrap`, `make gen-contracts`, `make check-contracts`, `make ci`。
- 建立 dependency boundary check，阻止 `core` 依賴 Tauri、rusqlite、IO adapter。
- 建立 lint、format、unit/component/build CI。
- 實作 `get_build_info` 作為第一個完整 contract → command → TS wrapper 範例。
- README 的全新 checkout 啟動步驟不得超過五條命令。

## Contract

權威 Rust contract 至少包含：

```rust
pub struct EmptyRequest {}

pub struct BuildInfoDto {
    pub version: String,
    pub git_sha: String,
    pub build_profile: String,
}

pub trait CommandContract {
    const NAME: &'static str;
    type Request;
    type Response;
}
```

`get_build_info(EmptyRequest) -> BuildInfoDto` 必須從相同 Rust DTO 生成 TypeScript。生成檔禁止手改。

## 實作約束

- `core` 禁止 filesystem、network、clock、SQLite、Tauri。
- 生成輸出必須 deterministic；相同 checkout 連跑兩次 byte-identical。
- CI 中 contract check 必須以重新生成後 `git diff --exit-code` 類型機制阻斷 drift。
- `npm ci` 為權威安裝命令；lockfile 必須提交。
- Production build 不得依賴本機絕對路徑或未提交檔案。
- 不在本節點引入業務資料表、Markdown renderer 或 workspace 功能。

## BDD 場景

### 場景 1：全新 checkout

**Given** 一個乾淨 checkout  
**When** 執行 `make bootstrap && make ci`  
**Then** Rust/TS 測試、lint、contract check、frontend build 全綠，並可啟動空視窗。

### 場景 2：Contract drift

**Given** 修改 Rust DTO 或 command 名稱但未更新生成物  
**When** 執行 `make check-contracts`  
**Then** 命令失敗並列出具體差異檔。

### 場景 3：Core 邊界

**Given** 在 `core` 新增 `rusqlite` 或 `tauri` 依賴  
**When** 執行 `make ci`  
**Then** dependency boundary check 阻斷。

## 測試計畫

- `core` placeholder 純函數 unit test。
- `get_build_info` Rust serialization golden test。
- Generated TypeScript snapshot。
- Contract generator determinism test。
- CI negative test script：刻意製造 drift，確認非零 exit。
- Dependency allow-list/deny-list test。

## 驗收標準

- 三個 BDD 場景皆可在乾淨環境重現。
- `make ci` 為單一完整 gate。
- 空應用冷啟動可觀測且不產生未處理錯誤。
- `contracts/locks/N00.json` 已凍結。
- README 不依賴口頭知識。

## 性能與觀測

- 空應用 release build 冷啟動到可互動 `< 1.5 s`，記錄基準硬體。
- CI 每個階段輸出可辨識名稱與耗時。
- build info 與 command correlation ID 可在本地日誌確認。

## 非範圍

- SQLite schema。
- Workspace、render、annotation 等產品功能。
- 打包簽名、公證與多平台 release pipeline。

## 建議衍生任務

1. `T01-scaffold-rust-workspace`
2. `T02-scaffold-react-tauri`
3. `T03-contract-trait-and-generator`
4. `T04-generated-ts-wrapper`
5. `T05-core-boundary-check`
6. `T06-make-and-ci`
7. `T07-bootstrap-verification`

## Legacy 移植規則

可參考 legacy 的目錄與 CI，但禁止整包複製。先建立本節點測試與 contract，再逐檔移植有用配置；舊 command surface 不得帶入。


## 完成定義

除本節點特定驗收外，尚須同時符合：

- Contract lock 已建立且 drift check 為零。
- 測試先行證據已寫入 implementation plan 或 PR 描述。
- 本節點 BDD、unit/component/integration test 全綠。
- `make ci` 全綠。
- 無違反 `SPEC.md` INV-1～INV-8。
- `docs/verification/N00.md` 已附可重現命令與結果。
- `docs/metrics/node-outcomes.jsonl` 已追加結果。
- 沒有未記錄的規格偏差或未處理 blocker。
