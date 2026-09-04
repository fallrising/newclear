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
