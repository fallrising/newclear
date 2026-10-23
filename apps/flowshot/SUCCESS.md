---
project: apps/flowshot
purpose: 建立不修改原 Markdown 的本機閱讀與持久註記桌面工作區
kind: application
mainline: incomplete
usable_tag: none
reviewed: 2026-10-23
source_commit: b7f2a4311d1135977ba273efba8e77702b908036
---

# flowshot 成功契約

## 主線與範圍

[SPEC](SPEC.md) 的 v1 包含 workspace/tree、Markdown、安全渲染、tabs、
選取錨點、註記／留言／標籤、reanchor、搜尋、wikilink、Mermaid 與匯出。
主發行目標為 macOS13+ Apple Silicon／Intel；Windows/Linux 只保持可移植架構。
現有 N00 foundation 是必要前置，不取代閱讀與註記的主線。
Markdown 編輯、AI/RAG、雲同步、帳號、外掛及 terminal integration 都是 v1 非目標。

## 驗收條件

本次於 2026-10-23 重跑完整 Linux Docker/native gates；historical 仍只指既有紀錄。Foundation 驗收不表示產品旅程已完成；未完整驗收列使用 pending，原因記於證據欄。

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given foundation shell，When 取得 get_build_info，Then typed contract 的 loading／success／error 行為正確。 | passed | [N00 本次驗證](docs/verification/N00.md)：完整 Docker CI/native build/test，真實可見視窗與 WebView IPC 通過；獨立審查 ACCEPT。 |
| AC-02 | Given 受控目標 Mac，When 啟動 release，Then 可見視窗及 command completion 都少於1.5秒。 | pending | [T08](docs/tasks/N00/evidence/T08-macos-launch-observability.md)：hosted Run15 M1 command2318ms、Intel6256ms；診斷不作最終產品驗收，實體目標未過。 |
| AC-03 | Given Markdown workspace，When 閱讀、註記、重啟及原檔變更，Then 註記持久、可重定位且不修改原文。 | pending | [nodes](docs/nodes/README.md) 的N01 持久層已完成，後續 N02–N10 尚未以產品旅程交付；[App](src/App.tsx) 仍為 build-info shell。 |
| AC-04 | Given 完整 v1 workspace，When 搜尋、wikilink／Mermaid 與匯出，Then 輸出符合安全及資料權威契約。 | pending | [SPEC](SPEC.md) 與 A01–A07 節點有規格；缺實作及核心流程證據。 |

## 現況與缺口

N00 的 Rust workspace、React/Tauri shell、contract generator 與依賴邊界已存在。
T08 曾多次調整入口時序，但保留原1.5秒 oracle；hosted 診斷未關閉實體 Mac 閘門。
N00 開發驗收已 done：Linux Docker 完整 native 測試與真實視窗／IPC smoke 通過，獨立審查 ACCEPT。Mac 驗收另追蹤於 AC-02。
Owner 已於 2026-10-23 啟用 [開發 prompt](START_DEVELOPMENT_PROMPT.md)，恢復主線開發；原有節點依賴與產品驗收保留；owner 後續指示依 SPEC §13.1 分開 Linux 開發與 Mac 發行門檻，完成里程碑即提交並合併 PR。
可見視窗或 build-info 回傳不足以證明文件閱讀、資料持久與註記可用。

目標Mac的實測環境與產品時限仍依原規格，不能以調整CI分類自動關閉驗收。

## 啟動與驗證

從本目錄依 [README](README.md) 及 [Makefile](Makefile) 使用 Rust1.97.1、Node24.18.0。
入口是 `make bootstrap`、`make ci`、`npm run tauri -- dev`。
`make native-ci` 要求完整 Tauri host prerequisites；一般 ci 可明示 native skip。
目標 Mac 另跑 `make macos-launch-smoke` 並保存時間／視窗證據。
舊 README 的 standalone clone 名稱不代表要另建新 clone。

早期 portable-only 執行曾因缺少 host prerequisites 明示 native skip（T10 歷史證據）。後續 Docker 執行已通過完整 `make ci`、mandatory `make native-ci` 與真實視窗／IPC（N00 驗證報告）。目標 Mac 驗收與真實資料 dogfood 尚未完成；M0 已透過 PR #512 合併，未部署。

## 可用版本

目前 `usable_tag: none`。
必須完成既定閱讀／持久註記與 v1 功能節點，且關閉受控目標 Mac 驗收，才可建立 usable tag。
當前只能稱為 M0 foundation 與 SQLite 持久層，不具備全項目可用標記資格。

任何未來可用標記都須對應已合併的目標 SHA、必要 CI／審查與核心流程證據。
較早證據須先比對其後程式與設定差異；有關變更補驗後才能沿用。

## 2026-10-23 執行目標與驗證計畫

本次從來源 b7f2a4311d1135977ba273efba8e77702b908036 接續 N00；工作樹已有其他任務的未提交修改，予以保留。沿用 Rust/Tauri/React 技術棧。先修復 shared-workspace 建置／啟動路徑與 monorepo CI 入口、核對凍結契約及 SDD，再依原 graph 推進。詳細進度唯一入口為 [任務板](docs/tasks/BOARD.md)。

- AC-01：重跑可執行 foundation 測試、contract 與 build；新增失敗案例後修復。
- AC-02：原 `< 1500 ms` 門檻、PID 所屬原生可見視窗及 frontend command record 全保留。缺受控 Mac 時明記 blocked，不能以 Linux 或 hosted 診斷取代。
- AC-03：N01 schema → N02 workspace 與 N03 renderer → N04 tabs → N05 capture → N06 annotation → N07 comments → N09 reanchor → N10 orphan；A02 watcher 依 N02/N09。N00 未過時不把下游記成已完成。
- AC-04：N08 tags 依 N01/N04/N06；A01 search 依 N03/N06；A03 palette 依 N02/N04/A02；A04 filter 依 N08；A05 links 依 N02/N03/A02；A06 Mermaid 依 N03；A07 export 依 N02/N06/N07/N08。M0–M4 dogfood 閘門照 SPEC §13。

預定驗證入口：shared workspace launcher 下執行 SDD verify、Node script tests、frontend lint/test/build、Rust contracts/tests/lint、make ci；native 與目標 Mac gates 分開記錄。未跑的項目不宣稱通過。

## 本次交付狀態

N00 的 shared build／probe 路徑、非阻塞且有時限的 window probe、spawn failure／child cleanup、lock metadata 檢查、SDD revision validator 與 monorepo CI 入口已實作。獨立審查接受此 bounded repair；原始 Rust DTO、生成物、1.5 秒 oracle 與產品範圍維持原契約；lock 只同步 SPEC metadata，graph 依新開發驗收規則更新。

N00 開發驗收已通過，不等於主線完成、合併或部署。`usable_tag: none` 保持。N01/M0 已完成開發驗收（[證據](docs/verification/N01.md)），本里程碑已於 2026-10-23T03:24:25Z 合併 [PR #512](https://github.com/fallrising/newclear/pull/512)，三平台與專案契約 CI 全通過；下一步是 N02/N03/N04 與 M1 真實 KB 三天試用；Mac release 視窗／IPC／硬體／時間／截圖證據仍為發行缺口。

## 本次追加授權與 M0 驗證計畫

Owner 要求先修訂文件，再持續開發，完成里程碑後提交程式碼並建立、合併 PR。依 SPEC §13.1，先完成 Linux Docker N00 驗證，再完成 N01 schema/migration/repository，交付 M0。必跑完整 native gate、真實 Linux 視窗／IPC、migration/invariant/concurrency/restart tests、10k release benchmark、SDD 與獨立審查。AC-02 仍 pending；沒有 Mac 證據不阻塞此開發里程碑，但仍禁止 usable／release。

M0 執行結果：48 項 DB 檢查、完整 Linux native CI、真實視窗/IPC、app-data 初始化/重啟/損壞遷移拒絕均通過；root release migration+20k 寫入量測 203.374 ms，獨立審查 ACCEPT。尚未完成閱讀/註記 UI 或完整產品旅程；AC-03/04 保持 pending。

## M1 continuation scope (2026-10-23)

After M0 development acceptance, continue N02 workspace/PathGuard, N03 single deterministic safe Markdown model and N04 persistent lazy tabs. T-007 audits contract gaps; ADR-002 freezes the initial N03 canonical/model/security decisions before code. Root assigns shared/native integration separately. AC-03 remains pending until the actual reading/annotation journey exists. M1 requires the unchanged three-day real-KB trial; a local KB path has been requested and no trial is claimed.

M1 current evidence: candidate N03 functional checks pass, but the unchanged 1MiB benchmark fails in actual WebKitGTK 2.50.6 (mapped runs 7975/9139ms versus <300ms). N03 is not accepted; N04 implementation remains gated. ADR-004 records the planned session/CAS/close barrier for later implementation. N02 work continues independently.

M1 integration candidate verification: full Linux Docker CI/native build/tests, actual shell window/IPC and DB restart/corrupt-migration refusal passed on the integrated N02/N03 tree. This does not establish full reader UI, performance or dogfood acceptance. N02 remains implementing; N03 blocked; N04 todo. [ADR-005](docs/adr/ADR-005-render-performance-decision.md) records the renderer decision requested from the owner.

Current owner delivery request: commit and merge the verified partial N02/N03 implementation. This is an incremental source delivery under AC-03, not AC-03/M1 acceptance. Keep the renderer blocked and tabs unimplemented; no usable/release tag. Before merge require independent final harness/publication review, current SDD/project-success checks and remote Ubuntu/Apple Silicon/Intel CI. Existing local native and real WebView evidence remains applicable to unchanged source.
