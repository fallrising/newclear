---
project: products/phark
purpose: 以同源網頁提供多欄時間線與基本社交互動
kind: application
mainline: incomplete
usable_tag: none
reviewed: 2026-10-21
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# Phark Stream Deck 成功契約

## 主線與範圍

Spring Boot、React 與 SQLite 的單體產品，提供帳號、時間線、回覆、按讚、轉發、通知、搜尋、圖片與濫用控制。
[任務樹](docs/ROADMAP.md)的 SDD-001–011 已勾選，SDD-012 production durability 仍待辦。

維持 [README](README.md) 的 dormant 投入狀態；本次不恢復功能開發或部署。
本機 HTTP 範例的 SESSION_COOKIE_SECURE=false 不可外推為 HTTPS production 設定。

本契約核對的是上述來源版本中的文件與程式。
`complete` 只適用明列的主線範圍；沒有延伸為部署或生產保證。

## 驗收條件

下表 `historical` 是既有報告的結果，沒有在 2026-10-21 重跑。
`pending` 保留缺少證據或尚未實作的條件；程式存在不等於通過。

| AC ID | Given / When / Then | 狀態 | 證據或缺少原因 |
| --- | --- | --- | --- |
| AC-01 | Given 登入 session 與 CSRF，When 發文、回覆、按讚及轉發，Then 身份歸屬、冪等計數與游標分頁符合契約 | historical | [帳號驗證](docs/specs/005-accounts-profiles/verification.md)、[轉發驗證](docs/specs/007-post-reposts/verification.md) |
| AC-02 | Given 搜尋字串或合法圖片，When 查詢或上傳後讀取，Then bounded FTS5、不可變圖片與重啟後資料正確 | historical | [搜尋驗證](docs/specs/009-search/verification.md)、[圖片驗證](docs/specs/010-media-attachments/verification.md) |
| AC-03 | Given 既有資料庫升級，When migration、失敗及回滾，Then schema 與圖片 metadata/bytes 一致且不靜默破壞 | historical | [圖片驗證](docs/specs/010-media-attachments/verification.md)：V7→V8→V9 runtime 與 rollback |
| AC-04 | Given 持續使用的單體實例，When 線上備份與營運異常，Then SQLite online backup、metrics/alerts 及 deploy notifications 均有驗收 | pending | [任務樹 SDD-012](docs/ROADMAP.md)三項尚未完成 |

## 現況與缺口

核心社交流程有本機/runtime 歷史驗證，不能因 dormant 就改成已結束的無執行主線。
SDD-010 記錄 529 backend tests 與真 Docker/browser 結果，屬當時候選證據。
其 completion-head/post-merge gate 當時仍待交付紀錄；新資格需核對目前合併版本。
線上備份與營運通知仍是原任務樹明列缺口，不默默從主線移除。

這次僅新增驗收入口，未改變 runtime 或原有驗收 oracle。
歷史結果若與現行 source 有相關差異，必須補驗而不能直接繼承。

## 啟動與驗證

[README](README.md)提供單 image build/run、/data volume 與 health endpoint；[部署](docs/DEPLOYMENT.md)說明持久化設定。

已核對入口：[Docker build](Dockerfile)與 [frontend scripts](frontend/package.json)。
下列是該入口既有的啟動或驗證命令，並非本次執行紀錄；
需先完成連結文件中的依賴、設定及適用環境準備。

```sh
docker build -t stream-deck .
curl -fsS http://localhost:8080/actuator/health
```

執行後應保留來源 SHA、必要設定的非秘密摘要、命令與結果，
並將 runtime 證據逐項對回 AC；不得只用 health 或 exit 0 宣告全部完成。

## 可用版本

目前 `usable_tag: none`；本次沒有建立或發布任何 tag。
既有版本號、合併紀錄與歷史驗收不自動轉換為可用版本標記。

須先取得復工決定並完成 SDD-012，將 runtime/瀏覽器/資料恢復證據對齊目前 commit；普通歷史版本不等於 usable qualification。


## FE round2 — 2026-10-24T10:18:22Z

T-0380 R2-AC-10/E: approved M1–M3 API-only synthetic fixture, measured deck and existing form/accessibility improvements. [Task](fe-review/tasks/round2/task.md) fixes scope and validation. Original M1–M3 implementation and bounded local verification completed: real Session/CSRF API fixture, strict12-key shared capture selection,9route guards, keyboard/paging and exact logout proof. See [report](fe-review/tasks/round2/report.md) and [evidence index](fe-review/tasks/round2/result.json). Parent independent review/current-head CI/publication remain separate. Contrast incomplete, Search moderate landmark and historical unknown/FAIL are retained; no full R3 claim. Session/CSRF/quotas preserved, no backend/dependency/deployment or durability work. Mainline/AC-04/usable qualification unchanged.
