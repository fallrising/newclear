# 驗收記錄

日期：2026-09-21 初始文件驗證；2026-09-22 新增實機前置檢查。初次交付為 SDD、操作手冊、來源記錄與配置範例，當時未連線 VPS。部署前盤點見 [實機報告](LIVE-2026-09-22.md)；本次批准後已完成安裝與三台 nginx 驗證，見 [部署結果](DEPLOYMENT-RESULT-2026-09-22.md)。重灌與 snapshot restore 尚未執行。

## 本機已完成

| 檢查 | 工具／範圍 | 結果 |
| --- | --- | --- |
| 上游版本一致性 | 本機 Git checkout + JSON 與 upstream group_vars 比對 | quickstart/core/cli commits 與 9 個版本欄位一致 |
| Ansible 語法 | Python 3.12.3、ansible-core 2.19.3；固定 quickstart 的 cluster.yml 分別搭配 basic／quorum inventory | 兩份通過；未執行遠端 task |
| inventory 拓撲 | YAML parse；4 個唯一主機、3 worker、1 core、1 或 3 etcd、engine 分組及 storage plugin | 通過 |
| etcd／CNI 渲染 | Jinja 3.1.6 + StrictUndefined；生成 YAML／JSON 再解析 | 兩 profile 的所有 etcd／worker 範本通過 |
| 工作負載範例 | nginx appname／entrypoint／commands YAML 核對 | 通過 |
| 操作手冊 shell | 7 個 Bash code block 分別 `bash -n` | 通過；不代表 VPS 執行結果 |
| worker 重建範圍 | Ansible `--list-hosts` | node_containerd play 僅 worker-4；core 主機保留供 delegation |
| 文件連結 | 檢查專案 Markdown 的相對檔案連結 | 通過 |
| 變更空白檢查 | `git diff --check`，並檢查新增檔案尾端空白 | 通過 |

Ansible validator 安裝在 `/tmp` 隔離環境；該版本是本次 syntax check 工具，不是已驗證的 production runner 鎖定值。本次檢查腳本亦只在 `/tmp`，未新增 runtime 或測試框架到此專案。

## 尚未完成

SDD V04、V05 已 PASS；V01–V03 為 PARTIAL（Debian 首次部署、三台 lifecycle／CNI HTTP 通過，但未滿足原始全部條件）；V06–V11 為 NOT RUN。完整對照與 evidence 見部署結果，不能把原始 V01–V11 全部標成通過。

2026-09-22 已取得 4 台實際規格、私網診斷 evidence、6 份 release archive SHA256 及 nginx image manifest digest。已取得安裝／runtime 權限並產生實際私有部署 plan；供應商 API、完整 runner／OS package lock 與新 controller bootstrap 仍待完成。已實作 `scripts/labctl.py` 的計畫／執行／紀錄／對帳與有限清理；host bootstrap、membership／restore overlay 尚未實作。這些項目不以 YAML 語法通過替代。

## 後續每次 run 的記錄格式

```yaml
run_id: example-not-a-real-run
cluster_id: eru-vps-mvp
generation: 1
profile: basic
operation: fresh-rebuild
source_commit: REPLACE_WITH_PROJECT_COMMIT
inventory_hash: REPLACE_WITH_PRIVATE_INVENTORY_HASH
started_at: null
finished_at: null
provider_wait_seconds: null
install_seconds: null
result: NOT_RUN
failed_at: null
evidence_private_uri: null
acceptance:
  V01: NOT_RUN
  V02: NOT_RUN
  V03: NOT_RUN
  V04: NOT_RUN
```

此片段是操作記錄範本，不是 Eru deploy spec。完整 run journal 放在叢集外的私有儲存，公開摘要不包含 IP、credential、provider account 或業務資料。

## M2 第一部分：2026-09-22

21 項 Python 安全回歸通過。實機兩次 smoke 分別因 etcd timeout 與 core nil-context panic 失敗；第三次空目標 cleanup 被執行前 health check 正確阻擋，沒有刪除命令。失敗紀錄、配額修復、修補草案與後續缺口见 [M2 開發紀錄](M2-2026-09-22.md)。V06–V11 仍 NOT RUN，完整操作器整合驗證尚未通過。

## 自控元件重装計畫

依 owner 偏好新增 component-reinstall 預設、provider-reimage 後備模式與唯讀 ownership scope audit。累計 34 項本機測試通過，worker-4 六個元件檔案／三個狀態根的實機 scope 通過；該 plan 仍禁止執行。沒有清理／OS 重灌，不能算 V06／V08 PASS，見 [自控重裝](CONTROLLED-REINSTALL.md)。
