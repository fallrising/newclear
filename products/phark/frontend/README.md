# Stream Deck Frontend

React + TypeScript + Vite + shadcn/ui + Tailwind CSS。

完整專案說明請見 repository 根目錄：

- [../README.md](../README.md) — 快速開始
- [../docs/DEVELOPMENT.md](../docs/DEVELOPMENT.md) — 開發指南

## 常用命令

```bash
npm ci
npm run dev      # 開發伺服器
npm run lint     # oxlint
npm run build    # TypeScript + Vite production build
```

`npm run dev` 會將 `/api/*` proxy 到本地的 backend `http://localhost:8080`。

Production build 由 Dockerfile 執行，產物嵌入 Spring Boot `static/` 目錄，與後端同源。
