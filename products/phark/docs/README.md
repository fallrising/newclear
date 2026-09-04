# Stream Deck 文檔索引

本目錄記錄 **phark** 專案的完整目標、架構與操作指南，供開發者或其他 LLM 接手時參考。

| 文檔 | 內容 |
|------|------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 部署藍圖、技術決策、與 Kubernetes 對照、SQLite 界線 |
| [DEVELOPMENT.md](./DEVELOPMENT.md) | 專案結構、本地開發、API 規格、環境變數、測試 |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | VPS 從零到上線的完整步驟（Docker、Traefik、GHCR、CI/CD） |
| [MIGRATIONS.md](./MIGRATIONS.md) | SQLite migration 撰寫、production 備份、驗證與失敗復原 |
| [ROADMAP.md](./ROADMAP.md) | 依優先級與依賴整理的產品任務樹 |
| [specs/001-timeline-pagination/](./specs/001-timeline-pagination/) | 時間線游標分頁的規格、設計與任務 |
| [specs/002-post-replies/](./specs/002-post-replies/) | 回覆與對話串的規格、設計與任務 |
| [specs/003-schema-migrations/](./specs/003-schema-migrations/) | SQLite 版本化 migration、legacy baseline 與復原規格 |
| [specs/004-consistent-api-errors/](./specs/004-consistent-api-errors/) | RFC 9457 錯誤契約、validation errors 與 request correlation |
| [specs/005-accounts-profiles/](./specs/005-accounts-profiles/) | Session authentication、CSRF、content ownership 與公開 profile |
| [specs/006-post-likes/](./specs/006-post-likes/) | 冪等 post likes、viewer-aware count 與 optimistic UI |
| [specs/007-post-reposts/](./specs/007-post-reposts/) | Repost attribution、mixed timeline fan-out 與相容 cursor |
| [specs/008-notifications/](./specs/008-notifications/) | 帳號通知的規格、設計、任務與驗證 |
| [specs/009-search/](./specs/009-search/) | 公開文章搜尋的規格、設計、任務樹與驗證 |

## 部署模板

可複製到 VPS 或 GitHub 的設定檔位於 [`deploy/templates/`](../deploy/templates/)：

```
deploy/templates/
├── edge/compose.yml          # Traefik 路由層
├── edge/.env.example
├── deck/compose.yml          # 應用服務
├── deck/.env.example
├── scripts/deploy-deck         # 具回滾的部署腳本
├── scripts/deploy-deck-ssh     # SSH forced-command wrapper
└── github/workflows/ci-cd.yml  # GitHub Actions（待加入 repo）
```

## 專案常數（請依實際環境替換）

| 項目 | 預設值 |
|------|--------|
| GitHub repository | `fallrising/phark` |
| Container registry | `ghcr.io/fallrising/phark` |
| 應用名稱 | `deck` |
| 網域 | `deck.example.com` |
| VPS 部署使用者 | `deploy` |
| 應用資料目錄 | `/opt/apps/deck/data` |
| SQLite 路徑（容器內） | `/data/deck.db` |
| 容器執行 UID/GID | `10001` |

## 里程碑狀態

**已完成（應用程式里程碑）**

- [x] 單體 Spring Boot + React 應用
- [x] Dockerfile multi-stage build
- [x] Backend / Frontend 測試與 lint
- [x] 根目錄 README 基本操作說明

**待完成（部署里程碑）**

- [ ] VPS 安裝 Docker Engine 與 Compose
- [ ] Traefik 路由層（`edge-traefik` healthy）
- [ ] GHCR 推送與 VPS 拉取
- [ ] GitHub Actions CI/CD
- [ ] 部署腳本與 SSH forced command
- [ ] HTTPS 上線驗收

詳細驗收清單見 [DEPLOYMENT.md#第一輪完成標準](./DEPLOYMENT.md#第一輪完成標準)。
