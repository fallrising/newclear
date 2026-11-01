# CloudForm - Project Agent Instructions

## Project Overview
CloudForm is a Terraform Schema-Driven cloud resource provisioning platform with a WYSIWYG form designer. OPs use the designer to configure Terraform fields into user-facing and ops-facing forms, generating JSON/YAML configs that drive zero-code frontend rendering.

## Tech Stack
- **Backend**: Java 17, Spring Boot 3.x, Spring Security, Spring Data JPA
- **Frontend**: React 18+ (Vite), TypeScript, shadcn/ui, Tailwind CSS (shadcn dependency)
- **Database**: PostgreSQL (primary), Redis (cache/session)
- **Build**: Gradle (backend), pnpm (frontend)
- **API Style**: RESTful with OpenAPI/Swagger docs

## Project Structure
```
cloudform/
├── backend/                    # Java 17 Spring Boot
│   └── src/main/java/com/cloudform/
│       ├── config/             # Spring configs
│       ├── domain/             # Domain entities & enums
│       ├── dto/                # Request/Response DTOs
│       ├── repository/         # JPA repositories
│       ├── service/            # Business logic
│       ├── controller/         # REST controllers
│       ├── workflow/           # Workflow engine
│       ├── terraform/          # TF schema parsing & generation
│       └── integration/        # External platform integration
├── frontend/                   # React + Vite
│   └── src/
│       ├── components/         # Shared UI components
│       ├── features/           # Feature-based modules
│       │   ├── designer/       # WYSIWYG form designer
│       │   ├── workflow/       # Workflow management
│       │   ├── forms/          # Dynamic form renderer
│       │   └── dashboard/      # Overview & monitoring
│       ├── hooks/              # Custom React hooks
│       ├── lib/                # Utilities & API client
│       └── types/              # TypeScript type definitions
└── docs/                       # Project documentation & planning
```

## Key Domain Concepts
- **ResourceTemplate**: A cloud resource type (e.g., AWS RDS, Aliyun ES) with its TF schema
- **FieldConfig**: Per-field configuration: visibility, editability, value source, data source API, validation
- **FormConfig**: Generated JSON/YAML that drives frontend form rendering (user form + ops form)
- **WorkflowDefinition**: 4-node approval chain with inter-node actions
- **ProvisioningRequest**: A single resource provisioning lifecycle instance

## Coding Conventions (Java)
- Use `record` for DTOs and value objects
- Use `sealed interface` for discriminated unions where applicable
- Prefer `Optional` return types over null
- Use `@Valid` + Jakarta Bean Validation for input validation
- Service methods should be transactional at the service layer
- Use constructor injection (no `@Autowired` on fields)
- Enum for fixed values: cloud providers, resource types, approval statuses

## Coding Conventions (React/TypeScript)
- Functional components only. No class components.
- Use shadcn/ui components as the base. Extend, don't reinvent.
- Zod for form validation schemas
- React Query (TanStack Query) for server state
- Feature-based file organization
- Type everything. No `any` unless absolutely unavoidable.
- Use custom hooks to encapsulate business logic

## API Design
- RESTful endpoints under `/api/v1/`
- Consistent response envelope: `{ data, error, message }`
- Pagination: `?page=0&size=20&sort=createdAt,desc`
- Error codes should be domain-specific, not just HTTP status codes
- All list endpoints should support filtering

## Testing
- Backend: JUnit 5 + Mockito for unit, @SpringBootTest for integration
- Frontend: Vitest + React Testing Library
- Test business logic thoroughly. Mock external integrations.

## Important Notes
- The form designer is the CORE feature. It must feel premium and responsive.
- JSON/YAML config generation is critical - this drives zero-code frontend rendering.
- Terraform schema parsing must handle provider schema accurately.
- Multi-cloud support (Aliyun, AWS) means abstractions must be cloud-agnostic where possible.
- All field configs should be auditable (who changed what, when).

## 主線與驗收文件先行

- 接手前先讀 [SUCCESS.md](SUCCESS.md)、相關規格與最近驗證紀錄，核對目前主線及缺口。
- 實作前先更新 SUCCESS 的本次目標、範圍、AC 與驗證計畫；不得為了完成而縮小已承諾主線。
- 收尾逐項記錄實際命令、結果、來源版本與未通過原因，同步 README 必要入口及項目進度；未跑不可寫通過。
- 主線全部驗收、必要 CI／審查通過並合併後，按 repo 共用規範建立 annotated `usable/<slug>/vX.Y.Z`，回讀遠端並更新索引。現行 owner 授權適用；本規則不授權部署或付費服務。
- 參考／封存項目保留其結束條件，不以新增文件當作可執行版本，也不因此恢復開發。
