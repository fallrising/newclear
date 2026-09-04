# Twitter Deck MVP — 單機 CI/CD Runbook

> **Repo:** [github.com/fallrising/obechow](https://github.com/fallrising/obechow)  
> **目標路徑：** `git push` → GitHub Actions build image → push GHCR → SSH 進 VPS pull + restart → `https://deck.<你的網域>` 看到新版。

---

## 前置假設

- VPS 是 Ubuntu 22.04+ / Debian，用 Docker CE（不是裸 containerd）
- 有一個網域，DNS 掛在 Cloudflare
- GitHub repo（private 也可以，GHCR 免費）
- GitHub Actions runner 能 SSH 到 VPS（公網 port 或 Tailscale 二選一，Phase 4 各有寫法）

## 目錄規劃

所有東西都在 `/srv` 下，好備份、好遷移：

```
/srv
├── edge/
│   └── compose.yml          # Traefik（ingress controller 替身）
├── apps/
│   └── twitter-deck/
│       ├── compose.yml      # desired state
│       └── data/            # SQLite 落地處（bind mount）
└── deploy.sh                # CD 的最後一哩
```

---

## Phase 0 — VPS 一次性準備

```bash
# Docker（已裝可跳過）
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # 重新登入生效

# 共用 edge network：Traefik 和所有 app 都掛這張網
docker network create edge

# 目錄
sudo mkdir -p /srv/edge /srv/apps/twitter-deck/data
sudo chown -R $USER:$USER /srv
```

> **註：** `docker` group 等同 root。單人 VPS 可接受；要收緊的話 Phase 4 末尾有 `authorized_keys` 鎖指令的做法。

---

## Phase 1 — Traefik（Ingress Controller）

`/srv/edge/compose.yml`：

```yaml
services:
  traefik:
    image: traefik:v3
    restart: unless-stopped
    command:
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --entrypoints.web.address=:80
      - --entrypoints.websecure.address=:443
      - --entrypoints.web.http.redirections.entrypoint.to=websecure
      - --certificatesresolvers.le.acme.email=you@example.com
      - --certificatesresolvers.le.acme.storage=/letsencrypt/acme.json
      - --certificatesresolvers.le.acme.httpchallenge.entrypoint=web
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./letsencrypt:/letsencrypt
    networks:
      - edge

networks:
  edge:
    external: true
```

```bash
cd /srv/edge && docker compose up -d
```

**DNS：** 在 Cloudflare 加 `deck.<網域>` A record 指向 VPS IP，**先灰雲（DNS only）**，讓 HTTP-01 challenge 能直連通過。之後要開橘雲（CF proxy），把 `httpchallenge` 那行換成 DNS-01：

```yaml
      # 取代 httpchallenge 那一行：
      - --certificatesresolvers.le.acme.dnschallenge.provider=cloudflare
    environment:
      - CF_DNS_API_TOKEN=<有 Zone.DNS edit 權限的 token>
```

**如果 80/443 已被既有 nginx 佔用**，三選一：

1. **最快打通：** 不裝 Traefik，app compose 改成 `ports: ["127.0.0.1:18080:8080"]`，手寫一份 nginx proxy conf 指向 `127.0.0.1:18080`。CI/CD 流程完全不變，只是 ingress 這格暫時還是手動 nginx。
2. Traefik 先聽 `8081/8444` 測通，之後再搬家。
3. 一次到位：把既有站台遷進 Traefik（每站一段 file provider config 或容器化）。

---

## Phase 2 — 專案骨架（本 repo 已實作）

Repo 結構：

```
obechow/
├── backend/                  # Spring Boot 3.x, Java 17, Maven
├── frontend/                 # Vite + React + TS + Tailwind + shadcn/ui
├── Dockerfile                # Phase 3 已完成
├── .dockerignore             # Phase 3 已完成
└── .github/workflows/deploy.yml  # Phase 4 待加
```

### 已實作功能

**Backend**

- Dependencies：`spring-boot-starter-web`、`spring-boot-starter-data-jpa`、`sqlite-jdbc`、`hibernate-community-dialects`
- `application.yml`：SQLite WAL、`SQLiteDialect`、`ddl-auto: update`、port 8080
- Entity `Post`：`id`、`author`、`content`（max 280）、`createdAt`
- REST API：
  - `GET /api/health` → `{"status":"ok"}`
  - `GET /api/posts?author=&q=` → 最新 50 則，可選作者 / 關鍵字篩選
  - `POST /api/posts` → 201 建立貼文
- SPA fallback：非 `/api` 的 GET（無副檔名）轉發到 `/index.html`

**Frontend**

- Deck 橫向欄位：**All**、**Mine**、**Search**
- Compose box（作者 + 內容，280 字計數器）
- 每欄每 5 秒輪詢 `GET /api/posts`
- shadcn/ui：Card、Button、Input、Textarea
- `vite.config.ts`：dev proxy `/api` → `http://localhost:8080`，build 輸出 `frontend/dist`

### 本地驗證（過了才進 Phase 3）

```bash
cd backend  && DB_PATH=../data/app.db mvn spring-boot:run
cd frontend && npm install && npm run dev
# http://localhost:5173 發文、看到列表
```

---

## Phase 3 — Dockerfile（單一 image）

`Dockerfile`（repo 根目錄）：

```dockerfile
# syntax=docker/dockerfile:1

# ---- frontend build ----
FROM node:22-alpine AS frontend-build
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- backend build ----
FROM maven:3.9-eclipse-temurin-17 AS backend-build
WORKDIR /backend
COPY backend/pom.xml ./
RUN mvn --batch-mode --no-transfer-progress dependency:go-offline
COPY backend/src ./src
COPY --from=frontend-build /frontend/dist ./src/main/resources/static
RUN mvn --batch-mode --no-transfer-progress -DskipTests package

# ---- runtime ----
FROM eclipse-temurin:17-jre-alpine AS runtime
WORKDIR /app
COPY --from=backend-build /backend/target/skan-backend-*.jar app.jar
VOLUME ["/data"]
EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75.0", "-jar", "app.jar"]
```

`.dockerignore`：

```
**/node_modules
**/target
**/dist
.git
.github
.agents
.codex
.idea
.vscode
data
*.log
```

Dockerfile 把前端 build 產物複製到 `src/main/resources/static`，Spring Boot 透過預設的 classpath resource handler serve 靜態檔；`SpaFallbackFilter` 負責深層 SPA 路由。

本地整包測試：

```bash
docker build -t obechow:dev .
docker run --rm -p 8080:8080 -v "$PWD/data:/data" -e DB_PATH=/data/app.db obechow:dev
curl -s localhost:8080/api/health   # {"status":"ok"}
# 瀏覽器開 localhost:8080，前端應該由 Spring 直接吐出來
```

---

## Phase 4 — GitHub Actions → GHCR

權威實作是 [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)，
行為 contract 是 [`docs/sdd/P04-ci-cd.md`](./sdd/P04-ci-cd.md)：

| Event | Build | GHCR push | SSH deploy |
|---|---|---|---|
| Pull request | ✅ | ❌ | ❌ |
| Push to `main`, deploy disabled | ✅ | `latest` + full SHA | skipped |
| Push to `main`, deploy enabled | ✅ | `latest` + full SHA | exact full SHA |

Workflow-level token permission is `contents: read`; only the `publish` job gets
`packages: write`. All actions use immutable commit SHAs. When upgrading an
action, verify its official release, replace the full SHA and version comment
together, then rerun `actionlint` and the production Docker build.

### Repository variable and secrets

Create these under **Settings → Secrets and variables → Actions**:

| Type | Name | Purpose |
|---|---|---|
| Variable | `DEPLOY_ENABLED` | Exact value `true` enables deploy; keep absent/false until Phase 5 passes |
| Secret | `SSH_HOST` | VPS hostname or IP |
| Secret | `SSH_USER` | Dedicated deploy user |
| Secret | `SSH_KEY` | Private half of the dedicated Ed25519 key |
| Secret | `SSH_FINGERPRINT` | Trusted VPS host-key SHA256 fingerprint |

```bash
# 本機產一把專用 deploy key
ssh-keygen -t ed25519 -f deploy_key -C "gha-deploy" -N ""
# 公鑰 → VPS 的 ~/.ssh/authorized_keys
# 私鑰 → repo Settings → Secrets → SSH_KEY

# 從可信管道核對 VPS 的 Ed25519 host public key，再計算 fingerprint。
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

不要只信任未驗證網路上的 `ssh-keyscan` 輸出；fingerprint 應從 VPS console
或另一條可信管道取得。先保持 `DEPLOY_ENABLED=false`，完成 Phase 5 後才改
為 `true`。

### Tailscale 變體

Tailscale 不在 P04 的凍結範圍。需要時另開 SDD node，加入官方
Tailscale action、OAuth secrets、`tag:ci` ACL 與 ephemeral runner 驗收，
並同樣以完整 commit SHA pin action。

### 選配加固

可在 dedicated deploy key 上先加 `no-port-forwarding,no-agent-forwarding,
no-X11-forwarding,no-pty`。若要再加 forced command，必須另寫並測試只接受
P05 exact command grammar 的 wrapper；不要在 `authorized_keys` 內用
`awk`/command substitution 動態重組 `SSH_ORIGINAL_COMMAND`。

---

## Phase 5 — 版本化 VPS app bundle

Repository-side bundle 已完成；權威檔案與行為 contract 是：

- [`ops/compose.yml`](../ops/compose.yml) → `/srv/apps/twitter-deck/compose.yml`
- [`ops/.env.example`](../ops/.env.example) → `/srv/apps/twitter-deck/.env`
- [`ops/deploy.sh`](../ops/deploy.sh) → `/srv/deploy.sh`
- [`docs/sdd/P05-vps-deployment-bundle.md`](./sdd/P05-vps-deployment-bundle.md)

部署入口只接受 `twitter-deck <40 位小寫 hex commit SHA>`。它會先
`docker compose config --quiet`，再只 pull/recreate `app` service，並用
`--wait --wait-timeout 120` 等待健康；任何步驟失敗都不會印出成功訊息。
它不接受 `latest`、任意 app/path，也不會 prune 主機的 image。

Compose bundle：

- 不 publish host port，只經 external `edge` network 和 Traefik labels 對外；
- 要求 operator 設定 `APP_HOST`，image repository 固定為本專案 GHCR；
- 把 `./data` bind mount 到 `/data`，container replacement 不刪 SQLite；
- root filesystem read-only，開啟 `no-new-privileges`，限制 json-file logs；
- 一般 `/tmp` 保持 `noexec`；SQLite JDBC native library 只可從 16 MiB
  `/sqlite-tmp` tmpfs 載入。

### 安裝 reviewed bundle

在 VPS 上 checkout 已通過 review 的 repository revision，然後：

```bash
sudo install -d -m 0755 /srv/apps/twitter-deck/data
sudo install -m 0644 ops/compose.yml /srv/apps/twitter-deck/compose.yml
sudo install -m 0755 ops/deploy.sh /srv/deploy.sh
sudo install -m 0600 ops/.env.example /srv/apps/twitter-deck/.env
sudo chown -R "$USER":"$USER" /srv/apps/twitter-deck
sudo chown "$USER":"$USER" /srv/deploy.sh

# 把 placeholder 換成真正 hostname；TAG 會由 deploy.sh 以 exact SHA 覆蓋。
editor /srv/apps/twitter-deck/.env
```

`.env` 至少要有：

```dotenv
APP_HOST=deck.example.com
TAG=0000000000000000000000000000000000000000
```

安裝前確認 Docker Compose 支援 `--wait`：

```bash
docker compose version
docker compose up --help | grep -- --wait
```

### Repository contract test

任何 bundle 變更都先在 repository root 執行：

```bash
tests/ops/deployment_bundle_test.sh
```

它會用真實 Compose resolve model，再用 fake Docker 驗證成功順序、錯誤
輸入零副作用、三種失敗停止點與禁止的 global/destructive 操作。這個 gate
同時在 pull request 與 `main` publication job 的 image build 前執行。

### GHCR 拉取授權

Package 預設 private：GitHub 開一個 PAT，只勾 `read:packages`，在 VPS 上用 deploy 那個使用者登入一次（存在 `~/.docker/config.json`）：

```bash
echo <PAT> | docker login ghcr.io -u fallrising --password-stdin
```

或者第一次 push 後把 package 設成 public，就免登入。

### 首次手動驗證

保持 repository variable `DEPLOY_ENABLED` 缺省或 `false`，先在 VPS 選一個
已由 P04 發佈的完整 SHA：

```bash
/srv/deploy.sh twitter-deck <40 位小寫 hex commit SHA>
cd /srv/apps/twitter-deck
docker compose ps app
docker compose logs --tail=100 app
```

只有在 container healthy、`https://<APP_HOST>/api/health` 回傳
`{"status":"ok"}`、且 replacement 後資料仍存在，才進 Phase 6 啟用
`DEPLOY_ENABLED=true`。

回滾使用相同受限入口與舊的完整 SHA：

```bash
/srv/deploy.sh twitter-deck <舊的 40 位小寫 hex commit SHA>
```

---

## Phase 6 — 首次部署與驗收

P06 先把「repository 已準備好」和「真的改 production」拆成兩個 gate。
前者可以在沒有 VPS 資料時驗證；後者一定要有 operator 授權及線上證據。

### Repository readiness

每個 PR 與 `main` publication 都會在 image build 前執行：

```bash
tests/ops/deployment_bundle_test.sh
tests/ops/rollout_preflight_test.sh
```

需要重做完整 runtime rehearsal 時，在 Linux Docker host 執行：

```bash
tests/ops/rollout_rehearsal_test.sh
```

Rehearsal 會建立唯一的 Compose project、bridge network、temporary SQLite
bind 與 synthetic full-SHA local tag，驗證 healthy A→B replacement、runtime
hardening 和資料持久化後，只移除自己建立的資源。它不會 pull app image、
publish port、接觸 VPS/DNS/GitHub，也不能作為 live deployment 證據。

### 外部輸入 gate

開始任何 VPS、DNS、secret、repository setting 或 deployment 變更前，
operator 必須提供並核對：

| 類別 | 必要資料／證據 |
|---|---|
| SSH | VPS host、port、dedicated user、可用 key、可信管道取得的 Ed25519 host fingerprint |
| Route | 正式 `APP_HOST`、VPS public IPv4、DNS A record exact match |
| Traefik | running container name、external `edge` attachment、ACME resolver `le` |
| Images | candidate release full SHA、不同的 rollback full SHA、兩者 GHCR read access |
| GitHub | `SSH_HOST`、`SSH_USER`、`SSH_KEY`、`SSH_FINGERPRINT` 權限及 environment/repository 管理授權 |
| Window | operator、手動 smoke 步驟、可接受 downtime、rollback window |

在資料未齊前，`DEPLOY_ENABLED` 必須維持缺省或 exact value `false`。

### Target-host read-only preflight

先安裝 P05 bundle，但不要呼叫 deploy。從與 candidate code 相同、已 review
的 repository checkout 在 VPS 上執行：

```bash
APP_HOST=<正式 hostname> \
EXPECTED_DNS_IPV4=<VPS public IPv4> \
TRAEFIK_CONTAINER=<running Traefik container name> \
ops/rollout-preflight.sh \
  twitter-deck \
  <candidate 40 位小寫 hex SHA> \
  <rollback 40 位小寫 hex SHA>
```

Preflight 會先驗證所有輸入，再 byte-compare checkout 與 `/srv` 內的
Compose/deploy bundle；之後只做 Docker/Compose capability、`edge`、
Traefik `le` resolver、resolved service/image、DNS A record、release 與
rollback manifest 的 read-only 檢查。成功訊息必須明示
`No deployment performed`。它不會執行 deploy、pull、up/down、login、
network mutation 或 prune。

### 首次手動 exact-SHA smoke

Preflight 全綠後仍保持 `DEPLOY_ENABLED=false`，由 operator 在 rollback
window 內執行：

```bash
/srv/deploy.sh twitter-deck <candidate full SHA>
cd /srv/apps/twitter-deck
docker compose ps app
docker compose logs --tail=100 app
```

接著必須從外部確認：

1. `https://<APP_HOST>/api/health` exact 回傳 `{"status":"ok"}`；
2. 建立一筆帶唯一識別值的 post，記錄 id/author/content；
3. 再以相同 candidate SHA 執行一次 replacement；
4. replacement healthy 後讀回相同 id/author/content；
5. 用 rollback SHA 執行相同入口時，operator 能在 window 內恢復。

只有上述 exact-SHA 手動 smoke 與 rollback 能力有可驗證證據後，才可在
另一次已授權操作把 `DEPLOY_ENABLED` 設為 exact value `true`。

### GitHub Actions live acceptance

1. `git push origin main`，確認 `publish` 成功且 `deploy` 實際執行成功。
2. 核對 workflow SHA、GHCR candidate tag 與 VPS running image 完全相同。
3. 開 `https://<APP_HOST>`，確認 API、SPA、TLS 與資料仍正常。
4. **驗收核心：** 改一行可識別前端文案 → push → 約 2–4 分鐘 → 重新整理
   看到同一 commit 的變更。

在取得 Actions 與 public HTTPS 證據前，不得宣稱 Phase 6 live activation
完成。

### 日常操作

```bash
# 看 app log
cd /srv/apps/twitter-deck && docker compose logs -f

# 看 Traefik 在幹嘛
cd /srv/edge && docker compose logs -f

# 回滾到任意舊版（必須是 GHCR 已發佈的完整 40 位 commit SHA）
/srv/deploy.sh twitter-deck <舊的完整 40 位 git sha>
```

---

## 打通之後的補件方向

照 K8s 缺什麼補什麼：

| 方向 | 說明 |
|------|------|
| **零停機** | 目前已有 health-gated recreate，但仍可能有幾秒 downtime。下一步需雙 replica 加 Traefik 權重切換或 blue/green project。 |
| **push 改 pull（GitOps）** | 把「Actions SSH 進來推」換成 VPS 上常駐 reconcile loop —— 定期比對 GHCR tag / git repo compose 與本機實際狀態，不一致就對齊。懶人現成品是 Watchtower。 |
| **SQLite 備份** | Litestream 常駐複寫到 Cloudflare R2，一個 sidecar container 搞定，災難復原就是從 R2 restore。 |
| **可觀測性** | 先上 Dozzle（看 log）+ Beszel（看資源），都是單容器級的輕量件。 |

---

## 實作進度對照

| Phase | 狀態 | 說明 |
|-------|------|------|
| Phase 0 | ⬜ VPS 手動 | Docker、edge network、`/srv` 目錄 |
| Phase 1 | ⬜ VPS 手動 | Traefik + DNS |
| Phase 2 | ✅ 完成 | 本 repo 後端 + 前端 MVP |
| Phase 3 | ✅ 完成 | `Dockerfile`、`.dockerignore`；本地 image smoke test 通過 |
| Phase 4 | ✅ 完成 | PR build 與 `main` GHCR publish 已通過；deploy 預設 skipped |
| Phase 5 | ✅ Repo bundle | versioned compose、受限 `deploy.sh`、contract tests；VPS 安裝仍為手動 gate |
| Phase 6 | ✅ Repo readiness | read-only preflight、216 assertions、local Docker rehearsal、PR/main publication；live activation 仍需外部資料 |
