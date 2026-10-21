---
project: apps/flowshot
purpose: 建立不修改原 Markdown 的本機閱讀與持久註記桌面工作區
kind: application
mainline: incomplete
usable_tag: none
reviewed: 2026-10-21
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# flowshot 成功契約

## 主線與範圍

[SPEC](SPEC.md) 的 v1 包含 workspace/tree、Markdown、安全渲染、tabs、
選取錨點、註記／留言／標籤、reanchor、搜尋、wikilink、Mermaid 與匯出。
主發行目標為 macOS13+ Apple Silicon／Intel；Windows/Linux 只保持可移植架構。
現有 N00 foundation 是必要前置，不取代閱讀與註記的主線。
Markdown 編輯、AI/RAG、雲同步、帳號、外掛及 terminal integration 都是 v1 非目標。

## 驗收條件

本表的 passed 僅表示本次已核對的靜態條件；historical 是既有紀錄，
不表示 2026-10-21 重跑產品。pending／failed 保留其實際缺口。

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given foundation shell，When 取得 get_build_info，Then typed contract 的 loading／success／error 行為正確。 | historical | [N00 T05](docs/tasks/N00/evidence/T05-build-info-slice.md)：2026-07-29 前端4與 core5 測試等；native 初次受環境阻擋。 |
| AC-02 | Given 受控目標 Mac，When 啟動 release，Then 可見視窗及 command completion 都少於1.5秒。 | pending | [T08](docs/tasks/N00/evidence/T08-macos-launch-observability.md)：hosted Run15 M1 command2318ms、Intel6256ms；診斷不作最終產品驗收，實體目標未過。 |
| AC-03 | Given Markdown workspace，When 閱讀、註記、重啟及原檔變更，Then 註記持久、可重定位且不修改原文。 | pending | [nodes](docs/nodes/README.md) 的後續 N01–N10 尚未以產品旅程交付；[App](src/App.tsx) 仍為 build-info shell。 |
| AC-04 | Given 完整 v1 workspace，When 搜尋、wikilink／Mermaid 與匯出，Then 輸出符合安全及資料權威契約。 | pending | [SPEC](SPEC.md) 與 A01–A07 節點有規格；缺實作及核心流程證據。 |

## 現況與缺口

N00 的 Rust workspace、React/Tauri shell、contract generator 與依賴邊界已存在。
T08 曾多次調整入口時序，但保留原1.5秒 oracle；hosted 診斷未關閉實體 Mac 閘門。
N00 仍 blocked，下游不能因建置成功而解鎖成已完成。
[README](README.md) 明示 foundation development；本次不啟動 dormant backlog。
可見視窗或 build-info 回傳不足以證明文件閱讀、資料持久與註記可用。

目標Mac的實測環境與產品時限仍依原規格，不能以調整CI分類自動關閉驗收。

## 啟動與驗證

從本目錄依 [README](README.md) 及 [Makefile](Makefile) 使用 Rust1.97.1、Node24.18.0。
入口是 `make bootstrap`、`make ci`、`npm run tauri -- dev`。
`make native-ci` 要求完整 Tauri host prerequisites；一般 ci 可明示 native skip。
目標 Mac 另跑 `make macos-launch-smoke` 並保存時間／視窗證據。
舊 README 的 standalone clone 名稱不代表要另建新 clone。

本次只核對文件、入口與證據連結；未執行產品建置、服務或外部整合。
未執行的產品驗收不會因本文件通過格式檢查而轉為通過。

## 可用版本

目前 `usable_tag: none`。
必須先關閉 N00 受控目標 Mac 驗收，再完成既定閱讀／持久註記與 v1 功能節點。
當前只能稱為 foundation scaffold，不具備全項目可用標記資格。

任何未來可用標記都須對應已合併的目標 SHA、必要 CI／審查與核心流程證據。
較早證據須先比對其後程式與設定差異；有關變更補驗後才能沿用。
