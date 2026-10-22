---
project: products/kith
purpose: 讓人類與受控代理在同一私有房間協作對話
kind: application
mainline: incomplete
usable_tag: none
reviewed: 2026-10-21
source_commit: 0524d26f645477fcbe5e6771ae0f5f61c64ae830
---

# Kith 成功契約

## 主線與範圍

[SDD](SDD.md)主線是單 operator 自託管群聊：穩定 Room seq、成員、MCP、hosted agent 與外部 runner 共享事件匯流排。
現行前端是 v2 web；[W0–W7 roadmap](docs/v2/09-roadmap.md)全部保留 VERIFIED 的歷史工程驗收。

不是 SaaS，也不是 E2EE；不允許個人訂閱池化、非 operator 喚醒 operator_personal 或非官方網頁抓取。
不與 Fanzloud 共用 CODEX_HOME/workspace；閱讀快記模組本次交付階段 1 快記與收件匣，屬獨立範圍，非聊天室主線。

本契約核對的是上述來源版本中的文件與程式。
`complete` 只適用明列的主線範圍；沒有延伸為部署或生產保證。

## 驗收條件

下表 `historical` 是既有報告的結果，沒有在 2026-10-21 重跑。
`pending` 保留缺少證據或尚未實作的條件；程式存在不等於通過。

| AC ID | Given / When / Then | 狀態 | 證據或缺少原因 |
| --- | --- | --- | --- |
| AC-01 | Given operator 建房並邀請第二人，When 雙方收發、重連與翻歷史，Then seq 一致、無重複、草稿與手機返回流程成立 | historical | [W0–W3 驗收](docs/v2/09-roadmap.md) |
| AC-02 | Given provider 設定與 fake-provider，When mention/stream/error/runtime switch，Then 完整回覆才落盤且失敗與 quota 邊界可見 | historical | [W4–W5 驗收](docs/v2/09-roadmap.md)：fake provider 邊界 |
| AC-03 | Given scoped bot token 與 fake CLI runner，When mention、trace、thread 及重連，Then accepted/running/摘要與事件接續符合契約 | historical | [W6–W7 驗收](docs/v2/09-roadmap.md)：43 pass、1 平台限定 skip、遮罩 0 |
| AC-04 | Given 實際選定 provider 與原生 CLI，When operator 完成 hosted/runner 核心對話並驗證撤權與成本限制，Then 同版真實整合證據可核對 | pending | W4 用 fake-provider、W6 用 fake CLI；[roadmap](docs/v2/09-roadmap.md)未提供對應真邊界資格 |

## 現況與缺口

### 閱讀快記階段 1（獨立範圍，#456，本機 VERIFIED）

本次目標：完成 #456 快記、收件匣、冪等／衝突與離線草稿、全部預定端點認證拒絕；依 [RC 清單](docs/plans/reading-capture-tests.md) 先 RED 再 GREEN，重跑 lint/unit/integration/web/E2E 及證據 validator。階段 2 不在範圍。

階段 0 歷史：[MVP 計畫](docs/plans/cloudflare-reading-capture.md) §7 的兩表草稿與 RC 測試清單。驗證計畫是先讓缺少草稿的 SQLite 隔離測試失敗，再驗證兩表、唯一鍵、原文與匯出 revision 契約；不將其替代 API/Web/Runner 驗收。聊天室 AC-01～04 的狀態不變。

| AC ID | Given / When / Then | 狀態 | 證據或缺少原因 |
| --- | --- | --- | --- |
| AC-RC0 | Given 既有聊天室 migrations，When 在隔離 SQLite 套用 docs 中兩表草稿並審閱 RC 計畫，Then 既有表／資料不變、唯一鍵與 revision 契約成立，RC-01～07 有 fixture、故障切點與明確斷言 | passed | [9 項 SQL 檢查](test/reading_capture/test_schema_draft.py)、[RC 清單](docs/plans/reading-capture-tests.md)、[RED/GREEN 報告](tasks/446-reading-capture-phase0/report.md)；僅階段 0 本機證據，PR 最終 CI／獨立審查另於 #449 記錄 |
| AC-RC1 | Given 手機 operator，When 快記、重送與斷線，Then RC-01～04 符合規格 | passed | [#456 報告](tasks/456-reading-capture-phase1/report.md)：RC-01～04 桌面／手機 7 項本地 CF E2E；7 項 D1/API 整合與全套後端 284 項通過。僅本機證據；最終 head CI／獨立審查與 merge 狀態在 PR #457 記錄 |
| AC-RC2 | Given 閱讀頁與 Runner，When 更新正文、編輯補充、匯出或建置失敗，Then RC-05～07 及 RC-04 接線後回歸通過 | pending | 階段 2 IN_PROGRESS（#463）；先凍結文章ID／受限憑證／建置與匯出契約，再依RC-05～07先RED後GREEN；尚無階段2通過證據 |

### 聊天室既有狀態

既有 M0–M7 與 W0–W7 工程驗收不撤回；incomplete 指完整真實代理使用資格尚未證成。
README 的既有部署網址是歷史敘述，本次沒有讀取服務或確認線上版本。
舊 AGENTS 的「只有規格」已落後於 source/roadmap；不得因此忽略現有程式或宣布重建。
W7 的 219.53 KiB 初始 JS 與 E2E 結果是固定 run，不是本次效能重測。

原始成功契約導入僅新增驗收入口；本次 #456 增補閱讀快記階段 1 runtime 與證據；聊天室驗收條件未縮減；W7 修正可見性觀測間隔，原失敗、診斷及600ms門檻保留於本次報告。既有 ws-cost 測試改用固定 Date，避免自然跨分鐘使限流計數重設而誤判。
歷史結果若與現行 source 有相關差異，必須補驗而不能直接繼承。

## 啟動與驗證

[Quickstart](docs/quickstart.md)與[README](README.md)區分 L1/L2、local D1 migration、bootstrap 與 feature flags；首次登入需 seed。

已核對入口：[package scripts](package.json)與 [runner entry](runner/main.ts)。
下列是該入口既有的啟動或驗證命令，並非本次執行紀錄；
需先完成連結文件中的依賴、設定及適用環境準備。

```sh
npm run db:migrate:local
npm run dev
npm run e2e:all
npm run e2e:validate
```

執行後應保留來源 SHA、必要設定的非秘密摘要、命令與結果，
並將 runtime 證據逐項對回 AC；不得只用 health 或 exit 0 宣告全部完成。

## 可用版本

目前 `usable_tag: none`；本次沒有建立或發布任何 tag。
既有版本號、合併紀錄與歷史驗收不自動轉換為可用版本標記。

須核對歷史驗收後的 source/config 差異，補選定真 provider 與 native runner 對話、撤權及成本邊界證據；本次不因已部署或 fake E2E 建立全項目標記。
