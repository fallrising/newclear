# CloudForm - 開發進度記錄

> 最後更新：2026-06-14

## 當前狀態：Phase 1 完成 ✅

### Phase 1: Foundation

#### ✅ 項目骨架 (P1.1)
- [x] Spring Boot 3.x + Java 17 項目（Gradle）
- [x] Gradle wrapper（8.14.3，含 foojay toolchain resolver 自動下載 JDK 17）
- [x] React + Vite + TypeScript 前端項目
- [x] shadcn/ui 初始化（`components.json` + `lib/utils.ts`）
- [x] Tailwind v4 配置（`@theme inline` + light/dark tokens）
- [x] Docker Compose (PostgreSQL + Redis)
- [x] `.gitignore` / `AGENTS.md` / `PROGRESS.md`

#### ✅ 數據庫 & Entity (P1.2)
- [x] Flyway 三個 migration：V1 建表、V2 阿里雲 RDS seed、V3 加 `tf_provider_version`
- [x] 6 個 JPA Entity（含 `tf_provider_version` 欄位）
- [x] 6 個 Repository（含 `findWithFilters` 動態過濾）
- [x] 7 個 Enum
- [x] `JpaConfig` 啟用 `@EnableJpaAuditing`（前次缺失）

#### ✅ TF Schema 解析 & 管理 (P1.3)
- [x] Schema artifact store 設計（方案 A：預生成 + manual fallback）
- [x] `tf-schema-generator/` 含 alicloud + aws 的 `main.tf` + `generate.sh` + README
- [x] `backend/src/main/resources/tf-schemas/` 手寫範例：
  - `alicloud-1.230.0.json`（含 `alicloud_db_instance` + nested `parameters` block + `pg_hba_conf`）
  - `aws-5.70.0.json`（含 `aws_db_instance` + `restore_to_point_in_time` + `timeouts`）
- [x] Parser（`com.cloudform.terraform`）：
  - Models：`TfRoot` / `TfProviderSchema` / `TfResourceSchema` / `TfBlock` / `TfAttribute` / `TfNestedBlock`
  - `TfSchemaParser`（Jackson，自帶 ObjectMapper 不污染 Spring 主 mapper）
  - `FieldTreeBuilder`（嵌套 block 展平成 dot-notation path）
  - `TfFieldNode`（展平輸出節點）
- [x] Repository 抽象：`ClasspathTfSchemaRepository`（dev/test 預設）、`FileSystemTfSchemaRepository`（prod）
- [x] 配置：`cloudform.tf-schema.source = classpath | filesystem`
- [x] 單元測試：`TfSchemaParserTest`、`FieldTreeBuilderTest`、`ClasspathTfSchemaRepositoryTest`

#### ✅ 基礎 API (P1.4)
- [x] 共用 DTO：`ApiResponse<T>` / `PageResponse<T>` / `ApiError`
- [x] Template API：CRUD + publish/archive，`/api/v1/templates`
- [x] TF Schema API：list / list resources / get tree，`/api/v1/tf-schemas`
- [x] Field Config API：list / upsert / batch / reset，`/api/v1/templates/{id}/fields`
- [x] 橫切：`GlobalExceptionHandler`（統一錯誤 envelope）、`OpenApiConfig`、`WebConfig` CORS
- [x] `ResourceTemplateServiceTest`

#### ✅ 文檔
- [x] `docs/01~06`（架構/Schema/數據模型/API/前端/路線圖）
- [x] `docs/02` 修正：`PLATFORM_DEFAULT` → `FIXED`（與 enum 對齊）
- [x] `docs/06` 修正：Gantt 日期改成相對天數，避免再次過期

### Phase 1 既有問題修正
- [x] `JpaConfig` 缺失 → 已加，時間戳會自動填
- [x] `App.tsx` 缺失 → 已建，router shell 接 AppLayout
- [x] `lib/utils.ts` 缺失 → 已建 shadcn `cn()` helper
- [x] `index.css` 缺 `@theme` → 已重寫成 Tailwind v4 標準寫法
- [x] Gradle wrapper 缺失 → 已加（8.14.3 + foojay resolver）
- [x] `ValueSource` 文檔/code 不一致 → 文檔對齊 enum
- [x] `ComponentType` enum → 已驗證 11 個值齊全
- [x] `docs/06` 過期日期 → 改成相對天數

### 前端基礎 (P2.1 - 提前)
- [x] App.tsx + Router（`/templates`, `/templates/new`, `/templates/:id/design`）
- [x] AppLayout + Sidebar + Header
- [x] API client（axios + 自動拆封 envelope + 錯誤 toast）
- [x] TanStack Query key factory
- [x] Types：`ApiResponse` / `PageResponse` / `TemplateSummary` / `SchemaSourceItem`
- [x] TemplatesListPage（呼叫 `GET /templates`，含 skeleton/empty/error 狀態）
- [x] CreateTemplatePage / DesignerPage placeholder

---

## Phase 2 - WYSIWYG Designer

### 架構決策（已定）
- **佈局**：三欄 Tree | Config | Preview
- **Drag & drop**：@dnd-kit（M2 引入）
- **動態表單渲染**：手寫 + react-hook-form + zod

### Milestone 1 ✅（本次）
- [x] shadcn 基礎組件（Button/Input/Label/Textarea/Select/Switch/Checkbox/RadioGroup/Tabs/Form/Card/Badge）
- [x] 前端類型補齊（FormTarget×4、ValueSource×5、ComponentType×11、TfFieldNode、SchemaTreeResponse、FieldConfig*）
- [x] Designer hooks：useTemplate / useSchemaTree / useFieldConfigs / useUpsertFieldConfig / useResetFieldConfigs
- [x] fieldConfigSchema：zod schema、defaultDraftForTfField、warnMappingMismatch
- [x] SchemaTreePanel：遞迴樹、已配置標記、required/computed 標記、Unmapped Configs 區段
- [x] FieldConfigPanel：Tabs（Basic/Mapping/Component/Values）、JSON textarea、軟提示 mapping mismatch、Submit/Discard
- [x] DesignerPage：三欄佈局，seed 模板無 `tf_provider_version` 時 fallback 到 schemas list

### Milestone 2 ✅
- [x] 結構化 JSON editors（DataSource STATIC|API / Validation / DependsOn，含 Raw 切換）
- [x] Tree 搜索 + filter chips（Configured / Required / Hide computed）+ 計數
- [x] @dnd-kit 拖拽分桶 + 排序 + 插入位置指示線
- [x] jsonb 綁定修正（`@JdbcTypeCode(SqlTypes.JSON)`）

### Milestone 3 ✅
- [x] Backend `com.cloudform.generation` package
  - FormConfigGenerator（sections by groupKey、巢狀 JSON object 輸出）
  - TfTemplateGenerator（HCL resource block + FIXED 字面量；tfPath 去重；嵌套 block 暫跳過）
  - RequiredApisExtractor（dataSource type=API endpoints 去重 + 參數合併）
  - GenerationService（持久化 formConfigJson + tfTemplate）
  - `POST /api/v1/templates/{id}/generate`
- [x] Frontend GenerateDialog（3 個 tab：Form Config / TF Template / Required APIs，含 Copy）
- [x] Designer header「Generate」按鈕

### 後續（M4+ / Phase 3+）
1. **P2.4 Preview Panel** — 用 Form Config JSON 即時渲染 User/OPs Form 預覽
2. **P2.6 Cross-Provider 產品族** — TemplatesListPage 按 resourceType 聚合 + Designer provider toggle + Custom Fields 升格
3. 嵌套 block 子欄位配置（nestingMode=LIST/SET/MAP）+ TF template 巢狀支援
4. **Phase 3 DynamicForm** — runtime 把 Form Config JSON 渲染成可用表單
5. **Phase 4 TF Orchestrator 整合** — TF Template 提交 + 雲商整合 + sync config

---

## 文件結構概覽

```
cloudform/
├── AGENTS.md / PROGRESS.md / README.md
├── docker-compose.yml
├── backend/
│   ├── build.gradle.kts / settings.gradle.kts
│   ├── gradlew / gradlew.bat / gradle/wrapper/*
│   ├── tf-schema-generator/         # 產 TF schema JSON 的腳手架
│   │   ├── alicloud/main.tf
│   │   ├── aws/main.tf
│   │   ├── generate.sh
│   │   └── README.md
│   └── src/
│       ├── main/
│       │   ├── java/com/cloudform/
│       │   │   ├── CloudFormApplication.java
│       │   │   ├── config/{JpaConfig,OpenApiConfig,WebConfig}.java
│       │   │   ├── controller/{ResourceTemplate,TfSchema,FieldConfig}Controller.java
│       │   │   ├── domain/{entity,enums}/...
│       │   │   ├── dto/{ApiResponse,PageResponse,ApiError,template/*,schema/*,field/*}.java
│       │   │   ├── repository/...
│       │   │   ├── service/{ResourceTemplate,TfSchema,FieldConfig}Service.java
│       │   │   ├── terraform/{TfRoot,TfProviderSchema,TfResourceSchema,TfBlock,...
│       │   │   │             TfSchemaParser,FieldTreeBuilder,TfSchemaRepository,
│       │   │   │             Classpath/FileSystem...Repository}.java
│       │   │   └── web/{GlobalExceptionHandler,ResourceNotFoundException,InvalidStateException}.java
│       │   └── resources/
│       │       ├── application.yml          (含 cloudform.tf-schema.source)
│       │       ├── db/migration/V1__V2__V3__*.sql
│       │       └── tf-schemas/{alicloud,aws}-*.json
│       └── test/java/com/cloudform/
│           ├── terraform/{TfSchemaParser,FieldTreeBuilder,ClasspathTfSchemaRepository}Test.java
│           └── service/ResourceTemplateServiceTest.java
└── frontend/
    ├── package.json / vite.config.ts / tsconfig*.json
    ├── components.json
    └── src/
        ├── main.tsx / App.tsx / index.css / vite-env.d.ts
        ├── components/layout/{AppLayout,Sidebar,Header}.tsx
        ├── features/templates/{TemplatesListPage,CreateTemplatePage,DesignerPage}.tsx
        ├── lib/{api,queryKeys,utils}.ts
        └── types/api.ts
```
