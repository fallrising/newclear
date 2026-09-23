# 13 — 能力地圖與參考關鍵字對照

版本：WS-SDD revision 1 · 狀態：產品規劃分類，非外部產品功能調查，也非已完成清單。

使用者提供的產品名稱／縮寫僅作需求發想與可追溯輸入。本文件不推斷其公司內部實作、API、授權方式或相容性，不複製品牌與入口清單。dim-gate 使用自己的穩定 capabilityId；未知縮寫保留待釐清，不能憑名稱承諾整合。

## 1. 深度標示

- **既有**：v0.1 已有的特定行為；一個 CI kind 或範例資料不代表整個能力完成。
- **W1–W5**：[14](14-workspace-delivery.md) 定義的 Mock 交付增量。W1 已驗收合併；W2 已驗收合併（PR36）；W3 合約固定、實作尚未完成，證據見 [STATUS](../STATUS.md)；W3–W5 目前只有規格。
- **後續**：能力被記錄，但不在 W1–W5 的完整互動承諾；開發前要補專業契約與驗收。
- **待釐清**：無足夠語義，暫不設可操作入口。

Mock 可以有完整的產品操作閉環，仍不表示操作真實資源。每個已上線能力另在 registry 標明 read-only／mock-interactive／live-adapter；目前沒有任何 live-adapter。後續能力只能出現在說明／路線圖，不能混入可操作選單的空頁。

## 2. 三視角能力矩陣

| ID／共用能力 | 輸入關鍵字（去重後保留原稱） | RD 視角 | Ops 視角 | Admin 視角 | 交付深度 |
| --- | --- | --- | --- | --- | --- |
| CAP-01 服務與基礎資料 | Common Data、Service CMDB、Server CMDB (Shopee TOC)、AZ Meta CMDB、Infra Product Meta | 服務／環境／資源關係 | CI、來源、位置、freshness、影響 | 模型／欄位／能力 metadata | 既有；W1 角色首頁投影已實作；W2 子資源與綁定已實作、待驗收 |
| CAP-02 計算與容器 | Compute、Elastic Machine Platform (EMP)、Container Instance Service (CIS) | runtime 規格、位置、需求申請 | 主機／叢集／namespace／工作負載與容量 | 模板與 adapter 能力範圍 | 既有 compute 申請；W2 K8s 唯讀；完整生命週期後續 |
| CAP-03 定時與批次工作 | Runonce Cronjobs、Job Platform、Mass Processing Portal | 服務定時／一次性任務及執行記錄 | worker 容量、失敗與重試 | 已註冊 recipe／限制 | 後續；既有 ProvisionJob 不冒稱通用 job 平台 |
| CAP-04 CI 與產物 | Development、Pipeline、Artifact Platform | build/test/package、定義與產物版本 | runner／artifact 整合健康及交付診斷 | recipe、artifact integration metadata | 既有 runs/synthetic Artifact；W3 definition；真 registry/runner 後續 |
| CAP-05 發布管理 | Deployment、SPACE Deployment Platform (SDP)、Application Release、Shopee Release Engine、Web FE Release Platform、Release Management | 服務發布／回滾／灰度 | prod 審批、變更影響與健康 | 發布能力模板與平台功能開關 | 既有模擬發布；W3 配置／業務流量；FE 專屬流程後續 |
| CAP-06 配置中心 | Config Center、Content Config Management System (CCMS)、CCMS UAT、Plugin Config Center、Endpoint Config Platform | 服務環境配置與版本差異 | 生效狀態／變更批准 | 平台配置能力與安全 schema | W3 服務配置；W5 平台配置；插件執行後續 |
| CAP-07 關聯／多模型資料庫 | Database、Relational Database Service (RDS)、Multi-Model Database (MMDB)、MySQL | database 使用與申請 | instance/database、容量、備份、維護 | DB 服務模板與 profile | 既有 database CI；專業管理後續 |
| CAP-08 資料庫工具與變更 | Database Tools、Database Requests、Change Data Capture (CDC)、Data Transmission Service (DTS)、Database Meta、Audit Review | 資料變更／存取申請、同步需求 | SQL 審核、遷移／同步執行與一致性 | 審核模板／整合政策 | 後續；工作單框架 W2 不等於 SQL/DTS 已實作 |
| CAP-09 快取／KV | Middleware、Key Value Store、Cachecloud、Redis | allocation／quota／服務綁定 | shared instance、容量與可見 consumers | catalog limits／access profiles | W2 Redis binding/resize 完整 Mock；key browser/failover 後續 |
| CAP-10 訊息與串流 | Kafka、Message Pipeline Platform、Message Bus Console | topic／producer／consumer 綁定 | cluster/topic、partition、retention、lag | topic 模板、profile、adapter | W2 topic create/bind；真流量、消息內容與通用 pipeline 後續 |
| CAP-11 搜尋與協調服務 | Elastic Search、ETCD、Zookeeper | index／namespace／依賴申請 | cluster、容量、備份與維護 | 類型與模板治理 | 後續；不以 Redis/Kafka schema 假裝通用支援 |
| CAP-12 儲存 | Storage、Unified Storage Service (USS) | volume/bucket／用途／quota | storage pool、attachment、容量 | class/template 治理 | 既有 storage CI；專業 provision/restore 後續 |
| CAP-13 主機維運 | Server Ops、Server Operations、Server Resource System (SRS)、Global TOC | 服務承載與維護影響 | inventory、維護、工單／作業 | 能力與整合治理 | 既有 CMDB/交付作業部分；專業 host ops 後續 |
| CAP-14 DNS 與 IP 入口 | Domain Name Service、Domain Name System (DNS)、IP Direct Service (IPDS) | 服務 domain／endpoint 需求 | record、IP 指向、驗證／變更 | template、route adapter | W3 端點 reference；DNS/IPDS 真管理後續 |
| CAP-15 入站流量 | Inbound Traffic、Application Load Balance (ALB)、Long Connection Service (LCS)、Network Load Balancer (NLB) | 服務入口、版本權重 | LB/listener/capacity、流量影響 | 支援模式／模板 | 既有 LB CI；W3 有界服務流量 Mock；LCS/NLB 專業操作後續 |
| CAP-16 服務內部流量 | Internal Traffic、Service Mesh (SPEX)、Service Dependency | 服務依賴、流量策略 | mesh/sidecar/連通診斷 | mesh adapter 與能力政策 | 既有配置拓撲；W3 有界策略；真 mesh 後續 |
| CAP-17 出站連線 | Outbound Traffic、External2、Source Network Address Translation (SNAT) | 外部依賴與出站需求 | egress/SNAT、位址／容量 | 申請模板與整合 | 後續；External2 細節待釐清 |
| CAP-18 網路與流量安全 | Network Security、Network Policy Management (NPM)、Traffic Security、SSL Certificates (CertMS)、SGW ACL | 服務連通／憑證需求 | policy/ACL、certificate 狀態與續期 | 能力註冊與允許模板 | 後續；W3 不涵蓋任意 ACL/憑證執行 |
| CAP-19 虛擬網路 | Virtual Network、Elastic IP Management (EIP)、Virtual Private Cloud (VPC) | 網段／固定出口需求與綁定 | network/subnet/EIP 分配與依賴 | network catalog | 既有 network CI；專業生命週期後續 |
| CAP-20 實體網路與品質 | Physical Network、Network Topology & Quality (Pingmesh)、IP Address Management (IPAM)、Network CMDB、Network SLI & SLO、Network Issue SOP System (NetSOP) | 服務網路影響摘要 | IPAM、實體拓撲、品質與處置 | 資料模型／來源／SOP 治理 | 既有通用 Relation 部分；實體網路及量測後續 |
| CAP-21 監控、日誌與追蹤 | Monitoring & Log、Service Monitoring Platform (SRM)、Shopee Log Platform、Shopee Monitoring Platform (SMAP)、Shopee Monitoring Platform、Shopee Eagle Eye (SEE) | 服務監控、RED/trace/log 與查詢上下文 | 基礎設施與服務觀测／異常 | observation adapter、欄位／存取政策 | 既有 RED/trace/log Mock；W4 設定／規則；真 collector 後續 |
| CAP-22 事件、通知與處置 | Event Center、Unified Notification、Incident/Issue Management、Reaction Platform | 服務事件、訂閱、申請結果 | 告警控制面、認領、抑制與診斷 | channel、template、通知路由 | 既有事件通知／incident；W4 規則控制面；W5 通知配置 |
| CAP-23 SRE 與可靠度 | Application SRE Tools、Campaign Portal、Autoscaler、Stress Test Platform、Downgrade Platform、Shopee Readiness Platform、DR Controller (MVP)、Application Disaster Recovery (ADR)、SRE Measure Dashboard、Platform SLI/SLO Dashboard、SLO System | 服務 SLO、擴縮／降級／容災需求 | 可靠度、容量、演練／事件影響 | 執行模板、guardrails | W4 固定 SLO/告警；自動擴縮、壓測、容災、降級執行後續 |
| CAP-24 SRE 變更與平台運行 | SRE Auto Ops System、SRE Change System、Statistics Platform、Platform SRE Tools、SEER、AZ Platform Service Desk | 服務變更／支援入口 | 變更隊列、運行統計與平台事件 | 整合／稽核配置 | W2 共用工作單；專業自動化後續；SEER 細節待釐清 |
| CAP-25 工單與預算 | Ticket Center、SPACE Workflow Platform (SWP)、SRE Support Hub、Budget、Budget System | 我的／團隊申請與成本需求 | 審批、交付、支援工作 | 模板、routing policy、預算政策 | W2 工作單投影；任意 workflow、ITSM SLA、真實 FinOps 後續 |
| CAP-26 平台基礎工具 | Basic Tools、SPACE APIGateway、IAM (previously UIC & SAM)、Privileged Access Management (PAM)、Low Code Platform | 可用能力與 effective scope | 資源操作權與批准 | 使用者／固定角色、平台 adapter 路由 | 既有 Mock RBAC；W5 本地用戶與 route；SSO/PAM/任意低碼執行後續 |
| CAP-27 平台開發與應用框架 | Platform Devs Tools、Application Framework (STS)、BFF Governance、Lib Portal | recipe／依賴與框架資訊 | runtime／整合健康 | 能力註冊、版本、契約及工具入口治理 | W5 registry 唯讀診斷；framework/SDK/BFF 實際整合後續 |
| CAP-28 待釐清的工具 | PFB、RAP、GAS Control Center、SDDL Center、MUSE Center、QA Copilot、Infra Bot Management | 待需求角色／工作流確認 | 待操作與資料來源確認 | 先記需求，不提供執行入口 | 待釐清；不猜縮寫含義、不假定 bot/AI 代理可操作權限 |

## 3. 如何新增能力

每個 capability 必須先指定：canonical entity、owner domain、provider support、RD consumer projection、Ops operator projection、Admin governance projection、required actions/scopes、read/write/approval/execution contracts、非支援行為、Mock scenario 與驗收。並非每項能力都有三個可操作頁面；例如 Admin 管理 Kafka 模板與 adapter，不再做一份 Kafka topic console。

能力必須可接到至少一條真實可驗證的流程；「新 menu + 靜態表格」只能算導航原型。新增第三方 adapter 另記來源/API 版本、credential owner、read-only/write 邊界、同步與部分失敗契約，再獨立驗證。不因參考清單含某平台名稱就宣稱相容或已整合。


W2 歷史本機驗證 checkpoint（2026-09-23；後已由 PR36 驗收合併，詳見 STATUS）：產品 `4a69e07` 通過321項原生測試、77/77 Chromium、2/2隔離；最終修正 `bf3f168` 通過8/8 Firefox／WebKit、實際版面／鍵盤檢查及3/3效能。獨立review關閉F01–04；仍須最終PR head CI、主控接受與實際合併，**尚未宣稱 W2 ACCEPTED/MERGED**。完整AC與歷史失敗以 [STATUS](../STATUS.md)、[W2驗證報告](../../../../.team/reports/dim-gate-w2-validation.md) 和PLAN為準。W3–W5、後續／待釐清能力尚未實作。
