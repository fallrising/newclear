# CloudForm

Terraform Schema-Driven cloud resource provisioning platform with a WYSIWYG form designer.

## Quick Start

### Prerequisites
- Java 17+
- Node.js 18+ / pnpm
- Docker & Docker Compose
- PostgreSQL 15+ (or use Docker)
- Redis 7+ (or use Docker)

### Development

```bash
# Start infrastructure
docker compose up -d

# Backend
cd backend
./gradlew bootRun

# Frontend
cd frontend
pnpm install
pnpm dev
```

### Architecture

```
TF Provider Schema -> WYSIWYG Designer -> Form Config JSON -> Zero-code Frontend Rendering
```

See [docs/](./docs/) for detailed design documents.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Java 17, Spring Boot 3.x, Spring Data JPA |
| Frontend | React 18, TypeScript, Vite, shadcn/ui |
| Database | PostgreSQL, Redis |
| Build | Gradle (backend), pnpm (frontend) |

## License

Proprietary
