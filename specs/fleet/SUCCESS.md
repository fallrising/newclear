---
project: specs/fleet
purpose: 以期望狀態協調個人 VPS 的 Compose 工作負載與入口
kind: service
mainline: incomplete
usable_tag: none
reviewed: 2026-10-23
source_commit: b7f2a4311d1135977ba273efba8e77702b908036
---

# Fleet Catalog 成功契約

## 主線與範圍

[SDD](docs/SDD.md)定義既有 Go/SQLite 控制面：fleet.yaml → 驗證／Compose 編譯 → fleetd desired state → outbound agent reconcile → catalog URL、版本、health 與 public/access/private 模式。
針對單 owner、2–10 台 pet VPS、5–40 個服務；不新增第二套平台、不接管正式 OneVPS/OneFleet，不使用 ClarkQ 當控制匯流排。

Owner 於 2026-10-23 明示執行 [開發啟動 prompt](START_DEVELOPMENT_PROMPT.md)。本次先完成 AC-01 同版驗證，再完成隔離真 Docker 的 AC-02 與 AC-04；AC-03 保留真實外部邊界要求。原定 AC 未縮小。

## 驗收條件

結果對應下列內容指紋；本里程碑的 PR、CI 與合併狀態以 [BOARD](docs/tasks/BOARD.md) 的交付紀錄為準，不代表完整主線已驗收或已部署。[驗收紀錄](docs/evidence/2026-10-23-acceptance.md)含來源／binary hashes、實際命令、歷史失敗、審查及環境限制。

| AC ID | Given / When / Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 合法或非法 fleet.yaml，When schema 驗證與 Compose 編譯，Then 只產生符合契約的 runtime 設定 | passed | 原生 schema/compiler/全套 tests、vet/build；新增 raw types/null、YAML 注入、hostname 保護及 Unicode 長度回歸；真容器 argv/env 保真 |
| AC-02 | Given fleetd 與節點設定，When agent 拉取 desired state 並 start/stop/redeploy，Then 真實工作負載與 catalog 狀態收斂 | passed | 同一隔離 VPS 的真實 fleetd/agent/SQLite/Docker/Compose/local registry；單 workload start/stop/redeploy、generation、health、container identity 閉環；無 CF 替身通過聲明 |
| AC-03 | Given public/access/private 三模式，When 執行 Cloudflare Tunnel/Access bootstrap，Then 路由與存取政策符合契約且私人服務不可公開 | pending | session 未設必要 CF credentials/account/zone/bootstrap 設定，未提供 WARP client；沒有執行真實入口驗收 |
| AC-04 | Given 節點或控制面重啟，When 恢復 desired state 與 health 上報，Then 不錯置 workload 或遺失控制狀態 | passed | agent 與 fleetd process restart、控制面 outage 下 running/stopped 收斂、fresh actual report、持久 identity/release/generation/port，以及缺 Compose/env/cache 的 uninstall；未測 host/Docker-daemon reboot |

## 現況與缺口

本次修正：schema raw types/presence、保護 hostname 正規化、Unicode 長度、安全 Compose/環境值編譯、CI image overlay 順序、secrets 合併，以及 generation 冪等、斷線快取 reconcile、缺檔與重啟 heartbeat 恢復。全部行為修正保留 RED → GREEN 證據，沿用既有依賴。

最終內容指紋：`7416734bd434f50d901d6c421782aae6bae5728ac8d4c4037019ecd67af60245`；實測基底為上述 source_commit，交付分支基於 `f64c7ef01532f717e963e7c1adec4cbae87f16e7`，元件內容未改。[原生輸出](docs/evidence/2026-10-23-native.txt)、[來源清單](docs/evidence/2026-10-23-source.json)、[真 Docker 結果](docs/evidence/2026-10-23-docker.json)對應同一候選。

獨立審查 ACCEPT 修正及最終測試 oracle。測試建立的程序與容器均已停止／移除，原容器清單恢復；既有服務無須停止。state、logs、images/artifacts 保留，真實主機／帳號／IP 與私有原始證據留在 repo 外。

仍需真 Cloudflare public/access/private 邊界驗證。Owner 已明示授權本里程碑提交、push、PR 與通過門檻後合併。新增 [root Fleet CI](../../.github/workflows/fleet-ci.yml)修正 nested workflow 不會在 monorepo 啟動的入口；遠端 CI 與合併結果記錄於任務板的交付紀錄。任務狀態在 [BOARD](docs/tasks/BOARD.md)。

## 啟動與驗證

本次實際透過共用 workspace launcher 執行 `scripts/verify.py`，使用已安裝 Go 1.27.1；原生 test、hello-healthz test、vet、schema tests、兩個主程式與範例 build 均 PASS。命令與輸出見[紀錄](docs/evidence/2026-10-23-acceptance.md#executed-verification)。本機缺 make，沒有把未執行的 Makefile targets 寫成通過；runner 執行其等價 Go 命令並將輸出導向 workspace。

`scripts/acceptance.py` 於授權隔離 VPS 透過 launcher 執行，Docker 29.8.1 / Compose 5.5.1，最終十項檢查及 cleanup PASS。Cloudflare 是 `not_run`，未用 loopback 結果替代。重跑前置條件及正式 bootstrap 在 [bootstrap](docs/bootstrap.md)。

歷史失敗保留：sandbox socket/DNS 限制、make 不存在、測試最初 cwd 錯誤、行為 RED，以及第二輪 uninstall oracle 的審查 REWORK；第三輪已用正確前置狀態驗證。Go 1.23 最低版本由 root CI 驗證；實際 run 結果見任務板。

## 可用版本

`mainline: incomplete`、`usable_tag: none`。文件／程式完成的本次修正、候選實測通過、遠端 CI、已合併與正式部署分開記錄；owner 已授權按里程碑提交及合併 PR；未執行 tag、release 或正式部署。

下一個最小步驟：取得專用 Cloudflare test configuration 與已註冊 WARP device，依 bootstrap 完成 AC-03 的未登入拒絕／登入與 WARP 成功／私人服務無公開 DNS 證據。AC-01/02/04 的修正可獨立交付；只有 AC-03 也通過後，才核對完整主線的可用版本資格。
