# CloudForm - 系統架構總覽

## 系統定位

CloudForm 是一個 **Terraform Schema-Driven** 的雲資源配置平台。核心理念是：

> **OPs 通過可視化設計器配置 Terraform 欄位行為 → 自動生成 JSON/YAML 表單配置 → 前端零代碼渲染表單 → 用戶填寫 → 審批工作流 → 自動生成 TF → 雲資源創建 → 同步狀態 → 初始化**

## 高階架構圖

```mermaid
graph TB
    subgraph Designer["🎨 WYSIWYG 表單設計器"]
        TFS["TF Schema\n(完整欄位樹)"]
        FC["欄位配置面板\n(visibility, source, api...)"]
        Preview["即時預覽\nUser Form | OPs Form | Result"]
        TFS --> FC --> Preview
    end

    subgraph Config["📄 生成配置"]
        FormJSON["Form Config\n(JSON/YAML)"]
        TFTemplate["TF Template"]
        APISpec["API Interface\nDefinition"]
        SyncSpec["Sync Config\n(同步規格)"]
    end

    subgraph Runtime["⚡ 運行時"]
        FE["前端動態表單\n(Schema-Driven Render)"]
        WF["工作流引擎\n(4-Node Approval)"]
        TFGen["TF Generator"]
        TFApply["TF Apply\n(via Internal Platform)"]
        Sync["同步任務\n(Instance ID Matching)"]
        Init["資源初始化"]
    end

    subgraph External["🌐 外部系統"]
        Cloud["雲商平台\n(Aliyun / AWS)"]
        IDP["內部 TF 平台"]
    end

    Designer --> Config
    FormJSON --> FE
    FE --> WF
    WF --> TFGen
    TFTemplate --> TFGen
    TFGen --> IDP
    IDP --> TFApply
    TFApply --> Cloud
    Cloud --> Sync
    Sync --> Init
```

## 核心模組

### 1. Terraform Schema Engine
- 解析 Terraform Provider Schema（JSON 格式，由 `terraform providers schema -json` 生成）
- 建立資源欄位樹（支持嵌套 block）
- 欄位元數據：type, required, optional, computed, description, default
- 支持的 Provider：`alicloud`, `aws`

### 2. WYSIWYG Form Designer
- **左側面板**：TF 欄位樹，可展開/折疊，搜索過濾
- **中間面板**：欄位配置（選中欄位後出現）
- **右側面板**：即時預覽，3 個 Tab：
  - User Form（業務用戶看到的表單）
  - OPs Form（OPs 看到的表單）
  - Approval Result（審批結果頁/只讀摘要）

### 3. Field Configuration Model
每個 TF 欄位可配置：

| 屬性 | 類型 | 說明 |
|------|------|------|
| `fieldKey` | string | TF 欄位路徑，如 `instance_type` 或 `vpc_config.vpc_id` |
| `displayName` | string | 前端展示名稱（i18n key） |
| `description` | string | 欄位說明/幫助文本 |
| `formTarget` | enum | `USER_FORM` / `OPS_FORM` / `HIDDEN` / `RESULT_ONLY` |
| `editable` | boolean | 用戶/OPs 是否可編輯 |
| `valueSource` | enum | `FIXED` / `USER_INPUT` / `OPS_INPUT` / `SYSTEM_DEFAULT` / `API_DRIVEN` |
| `fixedValue` | any | 當 valueSource=FIXED 時的固定值（平台級預設） |
| `defaultValue` | any | 表單預設值 |
| `dataSourceApi` | string | 下拉選項的 API 端點 |
| `dataSourceParams` | map | API 請求參數（可引用其他欄位值，如 `${region}`） |
| `componentType` | enum | `INPUT` / `SELECT` / `MULTI_SELECT` / `RADIO` / `SWITCH` / `NUMBER` / `TEXTAREA` |
| `validation` | object | 校驗規則：required, min, max, pattern, custom |
| `order` | int | 表單中的排列順序 |
| `group` | string | 分組名（表單中的 section） |
| `dependsOn` | string[] | 依賴欄位（聯動，如 region 變了要重新拉 VPC） |
| `tfPath` | string | 映射到 TF 的實際路徑 |
| `platformDefault` | boolean | 是否由平台全局配置決定 |

### 4. Workflow Engine
```mermaid
stateDiagram-v2
    [*] --> Draft: 用戶創建申請
    Draft --> PendingTLApproval: 用戶提交
    PendingTLApproval --> PendingOpsAction: TL 審批通過
    PendingTLApproval --> Rejected: TL 駁回
    PendingOpsAction --> OpsFormFilling: OPs 認領
    OpsFormFilling --> PendingOpsTLApproval: OPs 填寫完成並提交
    PendingOpsTLApproval --> Provisioning: OPs TL 審批通過
    PendingOpsTLApproval --> OpsFormFilling: OPs TL 駁回(退回修改)
    Provisioning --> TFApplying: 生成 TF 並提交
    TFApplying --> Syncing: TF Apply 成功
    Syncing --> Initializing: 匹配到 Instance ID
    Initializing --> Completed: 初始化完成
    Provisioning --> Failed: TF Apply 失敗
    Syncing --> Failed: 同步超時
    Initializing --> Failed: 初始化失敗
    Rejected --> [*]
    Completed --> [*]
    Failed --> PendingOpsAction: 重試
```

### 5. Cross-Provider 資源產品族（Product Family）

端用戶看到的入口是 **資源類型（RDS / Elasticsearch / ...）** 而非「ALIYUN-RDS」+「AWS-RDS」兩條獨立路徑。同一 `ResourceType` 下，不同 `CloudProvider` 是一個 product family 的多個變體：

- **入口**：用戶選「RDS」，頁面提供 ALIYUN / AWS 切換 → 根據選中的 provider 載入對應的 Form Config。
- **共用 vs 特有欄位**：同 family 內每個 provider 的 TF Schema 是欄位**全集**；不同 provider 之間會有一批**語義共用欄位**（engine、storage_size 等）以及**provider 特有欄位**（AWS `multi_az`、Aliyun `pg_hba_conf`）。設計器要能標記共用語義，避免 OPs 在兩邊重複定義同一個業務欄位。
- **User Form vs OPs Form**：
  - User Form 偏「規格 / 用量」（engine、version、instance_class、storage）— 業務使用者關心的東西。
  - OPs Form **包含 User Form 全部欄位** + ops-only 欄位（cloud_account、region、VPC、vSwitch、zone、charge_type）。OPs 在審批時看到使用者提交的內容加上自己要補充的雲帳號 / 網路設定。
  - 提交流是：用戶填 User Form → 工單進入 PendingOpsAction → OPs 認領後填 OPs Form（已 prefill 用戶值）→ 提交審批 → 後端合併 User + OPs + Fixed 值 → 生成 TF。
- **自定義欄位（Custom Fields）**：除了 TF Schema 對應欄位外，可追加 `tfPath=null` 的自定義欄位 — 這些不會直接寫進 TF 主資源，而是傳給**下游 Terraform Orchestrator 服務**，用於配套基礎設施配置（VPC / Subnet 創建或選擇、安全組規則、初始化參數等）。Designer 中目前用「Unmapped Configs」section 暫表示，後續會升級為「Custom Fields」首類概念並提供顯式新增 UX。

> 為什麼這樣：使用者不該被「雲商」這個概念綁架 — 他要的是「一個 RDS」，OPs 才需要關心「在哪個雲、用什麼帳號」。同時 TF Schema 本身不包含管理 VPC / subnet / 初始化等附加流程的欄位，所以需要 custom-field 通道與 TF orchestrator 對接。

### 6. Config Generation（設計器的輸出）

設計器配置完成後，生成以下產物：

#### a) Form Config (JSON/YAML)
驅動前端零代碼渲染的表單配置文件。

#### b) TF Template
帶有 variable 佔位符的 `.tf` 模板，用於後續填充用戶/OPs 數據後生成實際 TF。

#### c) API Interface Definition
該雲資源需要的後端 API 列表（如 list regions, list vpcs, list instance types），可直接生成 Controller/Service 骨架。

#### d) Sync Config
定義需要從雲商同步什麼數據、用什麼 API、匹配邏輯是什麼。

## 數據流

```mermaid
sequenceDiagram
    participant OPs as OPs (設計器)
    participant BE as Backend
    participant DB as Database
    participant FE as Frontend
    participant User as Business User
    participant TL as Team Lead
    participant OpsTL as OPs TL
    participant IDP as TF Platform
    participant Cloud as Cloud Provider

    Note over OPs: 設計階段
    OPs->>BE: 導入 TF Provider Schema
    BE->>DB: 儲存欄位樹
    OPs->>BE: 配置每個欄位行為
    BE->>DB: 儲存 FieldConfig
    OPs->>BE: 生成 Form Config
    BE->>DB: 儲存 JSON/YAML + TF Template

    Note over User: 運行階段
    User->>FE: 打開資源申請頁
    FE->>BE: 獲取 Form Config (User Form)
    FE->>User: 渲染動態表單
    User->>FE: 填寫並提交
    FE->>BE: 提交申請
    BE->>DB: 創建工單 (Draft → PendingTLApproval)

    TL->>BE: 審批通過
    BE->>DB: 狀態 → PendingOpsAction

    OPs->>FE: 打開 OPs Form
    FE->>BE: 獲取 Form Config (OPs Form)
    FE->>OPs: 渲染 OPs 動態表單
    OPs->>FE: 填寫雲帳號/region/VPC/... 並提交
    FE->>BE: 提交 OPs Form Data

    OpsTL->>BE: 審批通過

    BE->>BE: 合併 User + OPs + Fixed 數據
    BE->>BE: 用 TF Template 生成完整 TF
    BE->>IDP: 提交 TF 到內部平台
    IDP->>Cloud: terraform apply
    Cloud-->>IDP: 返回 Instance ID
    IDP-->>BE: 回調/輪詢結果

    loop 定時同步
        BE->>Cloud: 查詢資源狀態
        Cloud-->>BE: 資源詳情
        BE->>DB: 更新資源狀態
    end

    BE->>BE: 匹配 Instance ID → 執行初始化
    BE->>DB: 狀態 → Completed
```

## 多雲抽象

```
CloudProvider (Interface)
├── AliyunProvider
│   ├── TF Provider: alicloud
│   ├── Resources: alicloud_db_instance, alicloud_elasticsearch, ...
│   └── APIs: Aliyun OpenAPI SDK
└── AWSProvider
    ├── TF Provider: aws
    ├── Resources: aws_db_instance, aws_elasticsearch_domain, ...
    └── APIs: AWS SDK for Java
```

## 目標雲資源矩陣

| 資源類型 | Aliyun TF Resource | AWS TF Resource |
|----------|-------------------|-----------------|
| RDS | `alicloud_db_instance` | `aws_db_instance` |
| Elasticsearch | `alicloud_elasticsearch_instance` | `aws_elasticsearch_domain` |
| Redis | `alicloud_kvstore_instance` | `aws_elasticache_replication_group` |
| MongoDB | `alicloud_mongodb_instance` | `aws_docdb_cluster` |
| ClickHouse | `alicloud_click_house_db_cluster` | `aws_clickhouse_*` (custom) |
