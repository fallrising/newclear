# 來源與證據邊界

查核日期：2026-09-27。網頁可能後續更新；repository 來源固定 revision。本文集區分：官方產品事實、repository 自述、本專案 proposed design、尚待執行驗收。下列資料不等於對上游程式碼完成安全審計。

## S01

[CF-Server-Monitor README — frozen revision](https://github.com/huilang-me/CF-Server-Monitor/blob/dfb9bf19c23479398c3835c5f96328364e194c85/README.md)

固定 commit `dfb9bf19c23479398c3835c5f96328364e194c85`；README blob `d4b1d0885ba883ea46d574d6ef5fac12e6481c61`。本次讀取 README 的架構／特性段落：Workers+D1+DO、Go Agent、monitor-only／無命令控制、多平台及免費台數自述。README 同時提到設定拉取與新版 WSS reporting，不能將其描述成絕對沒有任何下行資料。沒有跑上游、不採用它的台數作本專案容量保證，未複製任何上游實作。

## S02

[Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)

依據：Free requests、Paid minimum／included usage、超量與不同資源計費。設計中的請求公式是本專案推演，不是 Cloudflare 保證。本文只固定查核當時數字，部署前重查 account plan。

## S03

[Cloudflare D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)

依據：rows read/write、storage、index maintenance 與 Free/Paid 超限行為。實際 schema 的寫入放大必须量測；INSERT statement 數、batch 數、結果列數不能直接取代 billing counters。

## S04

[Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)

依據：DO 的 request/duration/storage 與 Free 支援條件；不把 D1 配額與 DO SQLite 配額混算。

## S05

[Durable Objects — WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)

依據：server-side WebSocket Hibernation API、喚醒後 constructor/state 處理。將 DO 限定為可重建通知投影是本專案選擇，並非產品只具此功能。

## S06

[Cloudflare Queues — delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)

依據：at-least-once delivery。初版未選用 Queues，來源只支援未來引入時不得假設 exactly-once 的取捨。

## S07

[Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/)

依據：storage 與操作計費。本文不承諾所有 R2 使用免費，也不設定雲端帳戶硬支出上限。

## S08

[Packer introduction](https://developer.hashicorp.com/packer/docs/intro)

依據：machine image、自動建置、多平台 artifacts；不等於同一 image 格式可直接在所有雲運行。

## S09

[cloud-init boot stages](https://docs.cloud-init.io/en/latest/explanation/boot.html)

依據：多階段首次啟動、套件／腳本與完成等待；需依目標 image 的 cloud-init 版本驗證。文件內 readiness 分層是 Edge Ops 設計。

## S10

[Terraform provisioners](https://developer.hashicorp.com/terraform/language/provisioners)

依據：官方建議先採 provider 支援機制、machine image 或 configuration management；任意 provisioner 行為難以由 resource model 預測。沒有說 Terraform 完全不能執行腳本。

## S11

[Terraform sensitive data](https://developer.hashicorp.com/terraform/language/manage-sensitive-data)

依據：sensitive 的遮罩與 state/plan 敏感資料風險；ephemeral/write-only 能力需依版本、provider 和欄位確認，不能泛化所有 user-data。

## S12

[AWS Systems Manager SSM Agent](https://docs.aws.amazon.com/systems-manager/latest/userguide/ssm-agent.html)

依據：受管節點代理接收管理要求、執行並回傳狀態；不是聲稱所有 AMI 都預裝或所有 telemetry 都由 SSM 收集。

## S13

[AWS CloudWatch Agent](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Install-CloudWatch-Agent.html)

依據：CloudWatch Agent 的 metrics/logs 角色。將其與 SSM 並列用來說明能力分工，而非要求 Edge Ops 依賴 AWS。

## S14

[Azure Linux VM Agent](https://learn.microsoft.com/en-us/azure/virtual-machines/extensions/agent-linux)

依據：Linux provisioning／cloud-init、VM Agent、extension handlers／fabric 角色。Azure observability 工具選型不在本次實作範圍。

## S15

[Google Cloud VM Manager setup](https://docs.cloud.google.com/compute/vm-manager/docs/setup)

依據：OS Config Agent／VM Manager 的機內管理責任；特定 OS/image 支援於 provider adapter 開發時重查。

## S16

[Google Cloud Ops Agent](https://docs.cloud.google.com/logging/docs/agent/ops-agent)

依據：Ops Agent 的 telemetry 角色，與 OS Config 管理功能區分。

## S17

[Ansible introduction](https://docs.ansible.com/projects/ansible/latest/getting_started/introduction.html)

依據：agentless automation 與遠端連線／playbook；將複雜配置交給既有配置工具是設計建議，非本次已接通功能。

## S18

[cloud-init CLI reference](https://docs.cloud-init.io/en/latest/reference/cli.html)

依據：clean/status 等管理工具與 image prepare 語義。本文刻意不提供可直接破壞現役機器 instance state 的清理命令；golden image identity 清理需逐 OS 驗證。

## S19

[Cloudflare D1 Database API](https://developers.cloudflare.com/d1/worker-api/d1-database/)

依據：batch transaction／錯誤 rollback、sessions 與 read replication。zero-row CAS 不自動失敗是 SQL 條件更新語義，因此本專案要求獨立 atomicity test，不把 JS 事後檢查當成已 rollback。

## S20

[Cloudflare Access — Validate JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)

依據：Access JWT validation；本專案另外設 workspace authorization、既有 WebSocket 撤銷與 CSRF 防護，不以 Access 登入本身取代應用授權。

## Repository evidence

本次 newclear base：`0497fc2ade6c1dd085623f700a368c4402ee22b1`，root tree：`74cd66e99e5b70c5af6cdccd98714c8a9958c8bf`。以下是邊界依據，不代表重新測試其他專案。

| ID | 固定來源 | 用途／範圍 |
| --- | --- | --- |
| R01 | [README](https://github.com/fallrising/newclear/blob/0497fc2ade6c1dd085623f700a368c4402ee22b1/README.md)、[PORTFOLIO](https://github.com/fallrising/newclear/blob/0497fc2ade6c1dd085623f700a368c4402ee22b1/PORTFOLIO.md) | canonical 位置、投資例外、host/workload authority |
| R02 | [taxonomy](https://github.com/fallrising/newclear/blob/0497fc2ade6c1dd085623f700a368c4402ee22b1/docs/taxonomy.md)、[doc tiers](https://github.com/fallrising/newclear/blob/0497fc2ade6c1dd085623f700a368c4402ee22b1/docs/portfolio-doc-tiers.md)、[CI](https://github.com/fallrising/newclear/blob/0497fc2ade6c1dd085623f700a368c4402ee22b1/docs/specs/monorepo-ci.md) | platform 分類、A-tier blocked quickstart、root workflow 規則 |
| R03 | [dim-gate README](https://github.com/fallrising/newclear/blob/0497fc2ade6c1dd085623f700a368c4402ee22b1/platform/dim-gate/README.md) | 現有 CMDB/UI demo 邊界；未審計全套實作 |
| R04 | [agent-platform README](https://github.com/fallrising/newclear/blob/0497fc2ade6c1dd085623f700a368c4402ee22b1/platform/agent-platform/README.md) | LLM/Cocoon lifecycle，不由 Host Agent 接管 |
| R05 | [fleet README](https://github.com/fallrising/newclear/blob/0497fc2ade6c1dd085623f700a368c4402ee22b1/specs/fleet/README.md) | public workload contract，非新主機平台的必要依賴 |

根與 platform 目錄盤點時未見適用的 AGENTS.md；本專案新增局部約定。根 `.team/PLAN.md` 僅讀開頭的權責與 dim-gate 交付入口，不修改其他 program，也沒有假稱讀完整份歷史 ledger。未讀取 private kernel 主機設定、未下載 credentials、未執行上游安裝器。

## 研究限制

沒有實際執行 Terraform/Packer/cloud-init、沒有安裝 Agent、沒有 CF 帳號配額或計費證據、沒有 live Cloudflare smoke、沒有完整上游 source/security audit，也沒有市場占有率排名證據。技術比較說明各官方產品的責任，不將「常見模式」写成「唯一最佳做法」。
