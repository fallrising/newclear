---
project: platform/spring-pool
purpose: 單人版本化腳本庫、固定版本 runbook 編排與 Markdown 匯出
kind: application
mainline: incomplete
usable_tag: none
reviewed: 2026-11-01
source_commit: 2eb29676863869a67f90dc68b8332ff1db87078e
---

# Spring Pool 驗收入口

## 主線與範圍

依既有 [SDD](docs/SDD.md) 與 [OpenAPI](contracts/openapi.json)，保存腳本文字的
不可變版本、編排固定版本步驟並匯出 Markdown。單一 owner；腳本不執行。
不增加 SSH、排程、團隊、secret storage、刪除或額外服務。

2026-11-01 接續 PR196：核對沒有替代功能交付後，補齊缺少的 Hono Worker／SSR
頁面與本機驗證，整合目前 main 的索引。原 SDD 的全部 `T-*` 編號和預期結果
保持不變；owner於2026-11-01批准將Referrer-Policy改same-origin以修正原生表單衝突，嚴格Origin／CSRF與無JS要求保留。下面 AC 僅為既有情境的導航分組，不是新的或較小的規格。

## 驗收條件

| ID | Given / When / Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 腳本及不可變版本，When 建立、更新、衝突、封存及重啟，Then 原文、版本、稽核與持久資料符合 SDD T-REV/T-CONC/T-SIZE/T-VAL/T-ARCH/T-RETAIN/T-PERSIST | passed | 本輪46 Rust及真實整合／重啟通過，見 [對帳](docs/evidence/pr196-reconciliation.md) |
| AC-02 | Given 固定版本 runbook，When 排序、更新與匯出，Then 保留原 pin、文字與安全 Markdown，符合 T-NF/T-EXP 及 runbook 邊界 | passed | CI41300325025：無JS編排／重新排序／匯出在desktop及mobile通過 |
| AC-03 | Given 無效或錯誤身份／CSRF／設定，When 呼叫 web 或內部 API，Then 按 T-AUTH/T-CSRF/T-BOUND/T-HEALTH 拒絕且不寫入 | passed | 缺失 config 已補；40 Node及21 real API/web contracts通過；真實 Access驗收另列 AC-05 |
| AC-04 | Given 真實本機 Workers/D1 與瀏覽器，When 無 JS 建立腳本及 runbook、遇 XSS／衝突並在手機操作，Then T-E2E-1/T-XSS-1/T-CONC-3/T-UI-1 通過 | passed | CI41300325025：6 browser通過、2原定project-selection skips；9張PNG已檢視，health無blocking finding |
| AC-05 | Given 專用且受 Access 保護的 staging，When owner 登入並執行同一核心旅程，Then 真實身份邊界與持久使用可驗證 | pending | 原計畫的 staging 授權已到期；本輪不部署、不宣稱線上驗收 |

## 現況與缺口

本輪已補齊 web 入口、SSR、表單／檔案處理與 pin 編排，完成型別、格式、
Rust/Wasm、40 Node、21真實 API/web與重啟持久化驗證。獨立審查發現的
多行 prose CRLF與缺失doctype問題已修正並重驗。CI41300325025在85542bbe通過原定瀏覽器旅程，9張響應式PNG已檢視。無JS Copy樣式修正與最終文件仍須同一套最終head CI通過後正常合併。
完整產品仍含 staging與 owner驗收，不以本機部分交付宣告完成。

本輪狀態見 [任務板](docs/tasks/BOARD.md) 與 [對帳證據](docs/evidence/pr196-reconciliation.md)。

## 啟動與驗證

[Quickstart](docs/quickstart.md) 保留原命令與限制；[README](README.md) 為入口。
從本目錄使用原 lockfile：`npm ci`、`npm run lint`、`npm run format`、`npm test`、
`npm run build`、`npm run test:local`；Rust：`cargo test --manifest-path api/Cargo.toml --locked`、
`cargo fmt --manifest-path api/Cargo.toml --check`、`cargo clippy --manifest-path api/Cargo.toml --locked --all-targets -- -D warnings`。
根目錄執行 `python3 scripts/check_indexes.py`；這些命令列舉不代表通過。

## 可用版本

`usable_tag: none`。本輪沒有 release/tag/deploy；本機交付以最終head CI、審查與正常合併為準；AC-05保持待驗。
