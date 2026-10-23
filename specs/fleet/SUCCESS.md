---
project: specs/fleet
purpose: 以期望狀態協調個人 VPS 的 Compose 工作負載與入口
kind: service
mainline: incomplete
usable_tag: none
reviewed: 2026-10-23
source_commit: 887c5574b6b4b93ca0dde7a6c58f1aeb17de517a
---

# Fleet Catalog 成功契約

## 主線與範圍

Owner 於 2026-10-23 明示移除私人網路入口，產品僅保留 `public` 與 `access`。目前操作路徑只使用 **Cloudflare Access web**：瀏覽器開啟 HTTPS 網址，郵箱收取一次性驗證碼，授權後進入服務。`public` 保留支援但目前不部署、不啟用；移除模式的規格、驗證器、Cloudflare route API、資料模型與範例一併移除。

既有 Go/SQLite 主線仍是 fleet.yaml → Compose 編譯 → fleetd desired state → outbound agent reconcile → 服務目錄、健康狀態與版本；規模為單 owner、2–10 台 VPS、5–40 個服務。

本次目標：刪除退役模式；舊設定必須拒絕且不得自動轉為公開入口。Access 必須有明確郵箱 allowlist，先建立登入政策才發布入口。保留公開模式的契約回歸，使用 Access 範例作為目前路徑。

## 驗收條件

| AC ID | Given / When / Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 合法或非法 fleet.yaml，When schema 驗證與 Compose 編譯，Then 只接受 public/access 並產生符合契約的設定 | passed | 本次 schema/validator 回歸、全套原生測試與 build 通過，退役模式被拒絕 |
| AC-02 | Given fleetd 與節點設定，When start/stop/redeploy，Then 工作負載與 catalog 收斂 | passed | 本次 Access-mode synthetic workload 真 Docker 十項 lifecycle/recovery 與 cleanup 通過；CF edge 未測 |
| AC-03 | Given access 模式與郵箱 allowlist，When 執行 Tunnel/Access bootstrap，Then 未登入不得到達 origin，授權郵箱登入後可使用服務 | pending | 需要 CF 設定及一次真實瀏覽器郵箱驗證；公開模式保留但目前不作上線驗收 |
| AC-04 | Given 節點或控制面重啟，When 恢復 desired state 與 health 上報，Then 不錯置工作負載或遺失控制狀態 | passed | 本次真 Docker 重啟／斷線恢復及 legacy SQLite 升級、資料保留／拒絕回滾回歸通過 |

驗證計畫：先寫退役模式拒絕、DB 升級、Access 空名單拒絕／政策先於入口的失敗案例，再修正至通過；原生 full test/vet/schema/build、隔離 Docker lifecycle、獨立唯讀審查、遠端 CI、合併與任務板收尾。沒有真實 Cloudflare 登入不得宣告 AC-03 通過。

## 現況與缺口

前次 [#506](https://github.com/fallrising/newclear/pull/506) 完成 compiler/recovery 修正與真 Docker lifecycle；[歷史證據](docs/evidence/2026-10-23-acceptance.md)和原始來源 hashes 保留，不能當成本次修改後的驗收。Owner 本次明示變更產品範圍；舊紀錄中的已撤回需求不再是驗收條件。

本次移除退役模式的 schema/validator、Cloudflare hostname-route API、網路路由設定與 route-ID runtime 欄位；舊資料透過交易式 migration 升級。Access 建立明確郵箱政策後才發布入口，API 不再用舊快照覆寫 reconcile 寫入的 IDs。原生／整合／審查結果記於 [本次證據](docs/evidence/2026-10-23-access-web.md)及 [BOARD](docs/tasks/BOARD.md)。

## 啟動與驗證

依 [bootstrap](docs/bootstrap.md)設定 Access web。開發驗證使用 `scripts/verify.py` 透過共用 workspace launcher 執行原生 test/example/vet/schema/build；`scripts/acceptance.py` 驗證隔離 Docker lifecycle，不能代替 Cloudflare 登入測試。遠端 CI 執行 `make test vet validate-schema build`（Go 1.23）。

## 可用版本

`mainline: incomplete`、`usable_tag: none`。本次刪除／修正可獨立提交合併；AC-03 仍需真實 Access web 未登入拒絕及授權郵箱登入成功的證據。需要 CF 設定位置及可收驗證碼的允許郵箱；不需要裝置註冊或網路客戶端。公開模式保留，但目前不啟用、不執行公開上線。
