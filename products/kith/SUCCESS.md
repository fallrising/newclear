---
project: products/kith
purpose: 讓人類與受控代理在同一私有房間協作對話
kind: application
mainline: incomplete
usable_tag: none
reviewed: 2026-10-21
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# Kith 成功契約

## 主線與範圍

[SDD](SDD.md)主線是單 operator 自託管群聊：穩定 Room seq、成員、MCP、hosted agent 與外部 runner 共享事件匯流排。
現行前端是 v2 web；[W0–W7 roadmap](docs/v2/09-roadmap.md)全部保留 VERIFIED 的歷史工程驗收。

不是 SaaS，也不是 E2EE；不允許個人訂閱池化、非 operator 喚醒 operator_personal 或非官方網頁抓取。
不與 Fanzloud 共用 CODEX_HOME/workspace；閱讀快記為另列的階段 0 設計交付，非聊天室主線；runtime 尚未實作。

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

## 本次里程碑：閱讀快記階段 0（IN_PROGRESS）

依 [issue #447](https://github.com/fallrising/newclear/issues/447) 交付 [計劃](docs/plans/cloudflare-reading-capture.md) §7 階段 0，保留原有 AC-01～04。

| AC ID | Given / When / Then | 狀態 | 證據或缺少原因 |
| --- | --- | --- | --- |
| RC0-01 | Given 現行 schema，When 在隔離 SQLite 載入草稿，Then captures/notes 約束成立且既有表與資料不變 | pending | 草稿與 red/green 驗證待交付 |
| RC0-02 | Given RC-01～07，When 核對測試清單，Then 每項有前置、操作、oracle、故障與證據需求 | pending | 清單待交付；不等同 runtime 通過 |

驗證計畫與授權見 [task](tasks/447-reading-capture-stage0/task.md)。階段 1/2、D1/瀏覽器 E2E、部署與真 provider 驗收不在本次範圍。

## 現況與缺口

既有 M0–M7 與 W0–W7 工程驗收不撤回；incomplete 指完整真實代理使用資格尚未證成。
README 的既有部署網址是歷史敘述，本次沒有讀取服務或確認線上版本。
舊 AGENTS 的「只有規格」已落後於 source/roadmap；不得因此忽略現有程式或宣布重建。
W7 的 219.53 KiB 初始 JS 與 E2E 結果是固定 run，不是本次效能重測。

這次僅新增驗收入口，未改變 runtime 或原有驗收 oracle。
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
