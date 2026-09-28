# 04 — Image、Terraform、cloud-init 與 Agent 初始化

本章同時是設計依據與學習說明，**不是可以直接在既有主機執行的安裝指南**。官方依據見 [S08–S18](../SOURCES.md)；所有 Edge Ops 功能仍為 proposed。

## 1. 先分清四種責任

| 元件 | 解決的問題 | 例子 | 不應誤認為 |
| --- | --- | --- | --- |
| Machine image | 開機時已有哪些 OS、套件與靜態基線 | 官方 Linux image、Packer 產出的雲端 image／VM template | Docker image 或已納管、有身分的那台機器 |
| Terraform | 要存在什麼基礎資源與關係 | instance、disk、network、firewall/security group、IAM、image ID、user-data | 永遠負責所有機內設定的 shell supervisor |
| cloud-init／供應商 first-boot 機制 | 新 instance 第一次啟動時如何完成基本設定 | hostname、users、authorized keys、套件、安裝／啟動 Agent | 常駐 job control plane 或保證每次重開都重跑全部步驟 |
| 常駐 Agent／configuration management | 上線後怎麼持續觀測、收斂配置或執行作業 | SSM、VM extensions、OS Config、自有受控 Agent、Ansible | 能在尚未安裝的空機上自己啟動的程式 |

你可以自行封裝 OS image，通常從受信任的官方 base image 建置，不必自己做 Linux 發行版。Packer 把建置步驟版本化，能為不同平台產生對應 artifacts；AMI、VM disk/template 與 container image 不是一個可直接到處互換的格式。[S08](../SOURCES.md#s08)

Terraform 可以透過 provisioner 上傳檔案／執行命令，但官方建議优先使用 image、provider 支援機制或專門的配置工具，因任意腳本的行為無法可靠由 Terraform resource model 推導。[S10](../SOURCES.md#s10) 因此「Terraform 建機後會安裝 Agent」應理解為一条組合管線，而非 Terraform 天生保證的固定步驟。

## 2. 推薦的責任鏈

```text
Image pipeline（可選，離線／CI）
  官方 base → 固定版本套件／Agent → 清除 instance-specific state → image ID/digest

Provisioning pipeline（例如 Terraform）
  network/IAM/disk/instance → 指定 image 與最小 first-boot 資料

First boot（例如 cloud-init）
  users/SSH/必要網路與時間 → 驗證並安裝 Agent → 啟動 monitor-only

Enrollment
  本機產生唯一私鑰 → 短效一次性註冊 → owner／可信 instance identity 核對

Optional initialization
  明確 host authority → opt-in executor → approved immutable recipe
  → precheck → apply → reboot/checkpoint（需要時）→ postcheck → ready

Day 2
  metrics/logs → 告警／調查 → 批准作業 → 可追溯結果 → 升級／退役
```

沒有 OS 或第一段可信啟動通道時，Agent 不可能安裝自己。首次需要 root 的安裝由 image builder、cloud-init、雲商擴充機制，或 operator 已授權的手動通道完成。collector 安裝完成後仍以非 root 執行；安裝時用 root 不等於常駐運行需要 root。

cloud-init 有多個 boot stage；套件與腳本通常在較後階段完成。其他服務應採合適的 systemd ordering 或外部 `cloud-init status --wait` 做 readiness gate；不要在 cloud-init 正在執行的腳本內等待它自己結束。[S09](../SOURCES.md#s09)

## 3. 主流雲的對照，而非市場排名

| 平台 | Image／首次設定 | 持續管理 | 指標與日誌 | 對本專案的啟示 |
| --- | --- | --- | --- | --- |
| AWS | AMI；支援的 Linux AMI 可用 user-data/cloud-init | Systems Manager SSM Agent 接收管理工作、回傳執行狀態 | CloudWatch Agent 是另一個 telemetry 角色 | 管理與觀測不必塞在同一個高權限程序 |
| Azure | VM image；支援映像可使用 cloud-init provisioning | Azure Linux VM Agent／extension handlers 與 fabric 整合 | 觀測可由對應 Azure monitor extension/agent 處理，另行選型 | 自有 Agent 不應直接刪除雲商 Agent 或取代平台通訊 |
| Google Cloud | Compute image／first-boot startup 機制 | VM Manager 的 OS Config Agent 提供 OS 管理功能 | Ops Agent 處理 telemetry | OS policy／patch 與 metrics/logs 是不同責任 |

AWS 依據 [S12–S13](../SOURCES.md#s12)，Azure 依據 [S14](../SOURCES.md#s14)，Google Cloud 依據 [S15–S16](../SOURCES.md#s15)。不同 image／OS 的預裝 Agent 與 bootstrap 行為不同；不能寫成「所有雲機預裝同一種 Agent」或宣稱同一 user-data 在所有平台有效。

Ansible 是另一條常見路徑：使用既有遠端連線來執行可重現配置，不要求先裝自有常駐 daemon。[S17](../SOURCES.md#s17) 需要大量套件、檔案、帳號與狀態收斂時，優先整合成熟配置工具，不在 Edge Ops 重新發明完整 configuration language。相同資源不可同時被多個 reconciler 互相改寫。

## 4. Edge Ops 的三條接入通道

### A. 既有機器只讀納管 — P0

owner 選定機器，透過既有可信維運通道安裝經驗證固定 release；建立非 root 帳號、只讀範圍與 systemd unit。產生 node key、註冊、收到 heartbeat 後完成監控接入。不修改既有 firewall、SSH、磁碟、Docker 或應用生命週期。

### B. 新 VM 初始化 — P2

Terraform／雲商 API 建資源，選官方 image 並注入最小 bootstrap。bootstrap 只做足夠安全上線的基線與安裝，不下載任意 latest script。剩下的初始化以獨立 JobRecipeVersion 執行，有版本、precheck、postcheck 與批准。

如果主機由 OneVPS 擁有，初始化仍委派 OneVPS；Edge Ops 僅追蹤狀態與證據。只有明確 standalone 的 disposable VM 才走 Edge Ops executor。

### C. Golden image — P2 後段

前兩條通道先可驗收，再用 Packer 加速：固定 base image、package snapshot／版本、Agent release digest、SBOM／來源證據與 image lineage。不得把私鑰、enrollment token、instance machine-id、SSH host keys、cloud-init instance cache、spool／job journal 封進可複製 image；清理在 image 建置／封存階段依 OS 規範進行，不在現役主機上照抄清除命令。

image 更新不等於已存在 VM 自動更新；需選 recreate/rolling replace 或配置更新策略。有狀態磁碟與備份另有生命週期。R2 只可作合適 artifacts／manifest 的儲存方向，不能假設所有供應商都能直接從 R2 啟動 OS。

## 5. Bootstrap 與身份安全

優先讓機器本地生成唯一 signing key；user-data 不放長期 fleet secret。一次性 token 短效、單次、窄 scope、伺服器只存 hash，並綁定預期節點資料。若基礎平台能提供可驗證 instance identity，另做 provider-specific verifier；不能只信任 node 自報 instance ID。

Terraform `sensitive` 多半只隱藏顯示，不會自動把資料排除在 state／plan 外。[S11](../SOURCES.md#s11) 即使短效 token 也要考慮 user-data、metadata、cloud-init logs、shell history、state 留存與 first-boot 失敗後處理；到期就重新授權，不能自動換成永久 token。

SSHD／firewall 變更與初始 root trust 是高風險獨立步驟。設計目標保留管理員 public-key／sudo、禁止 root SSH 與 SSH password login，但不能把尚未驗證的規則直接套用所有 image。先確保救援／主控台、第二連線驗證与明確失敗回復；P0 安裝不碰這些設定。

## 6. 初始化配方與失敗恢復

Recipe 用 `check → apply → verify`，只在 check 證明需要且已批准時 apply；步驟有資源 scope、version/digest、expected postcondition、timeout、needs_reboot、retry safety。比如建立已指定服務帳號與固定目錄；不能把「重新跑應該沒問題」當作 idempotent 的證明。

初版執行器一次只運行一個經簽署的步驟；整條 bootstrap workflow 保存 current_step、approved plan digest、attempts。後續步驟是新 attempt，可單獨 checkpoint；失敗不自動忽略繼續。

重啟前 durable 記錄 checkpoint 與預期 boot transition，重啟後先核對新 boot_id、node/generation、未過期 approval 與 postcondition，再允許下一步。無法核實時轉 unknown，需要 operator；不能以 VM 重新回應 ping 當初始化成功。

一般 shell 無法自動保證 rollback。每步必須聲明 `reversible`、`compensating` 或 `irreversible`；磁碟格式化、重灌與高風險網路切換不屬首版 recipes。外部 backup／recovery path 是前提，不是事後補救宣稱。

## 7. Ready 的定義

分開紀錄 `infra_created`、`bootstrap_started`、`enrolled`、`agent_online`、`initializing`、`ready`。ready 必須有所選 recipe 的 postchecks、所需服務狀態、重新開機後檢查（如適用）、管理通道確認與證據。Terraform apply 成功、Agent 上線、作業 exit 0，任一單點都不足以單獨證明 ready。

P2 驗收：兩台 disposable VM 從同一 recipe 初始化得到同一聲明狀態；第一台中途故障／重啟，恢復後不重複不可逆副作用；封裝 image 克隆後產生不同身份，舊 VM 不會被誤認成新 VM。
