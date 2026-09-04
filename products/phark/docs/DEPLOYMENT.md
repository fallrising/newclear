# VPS 部署指南

> 最後更新：2026-09-04

本指南描述如何將 **Stream Deck**（repository：`fallrising/phark`）部署到單台 Ubuntu VPS，實現可重現、可回滾的 CI/CD 流程。

部署設定模板位於 [`deploy/templates/`](../deploy/templates/)。
含 schema 變更的 release 必須另依
[MIGRATIONS.md](./MIGRATIONS.md) 完成停機備份、history 驗證與失敗復原。

## 假設與常數

```text
VPS OS         Ubuntu 22.04 / 24.04
應用名稱        deck
網域            deck.example.com
GitHub repo     fallrising/phark
映像            ghcr.io/fallrising/phark
SSH port        22
VPS 使用者      deploy
```

請將 `deck.example.com` 等佔位符替換為實際值。

---

## 步驟 1：安裝 Docker Engine 與 Compose

登入 VPS，使用 Docker 官方 apt repository。建議使用 `docker compose` CLI plugin，而非舊版 `docker-compose`。

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl ufw util-linux

sudo install -m 0755 -d /etc/apt/keyrings

sudo curl -fsSL \
  https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc

sudo chmod a+r /etc/apt/keyrings/docker.asc

. /etc/os-release

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${UBUNTU_CODENAME:-$VERSION_CODENAME} stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

sudo apt-get update

sudo apt-get install -y \
  docker-ce \
  docker-ce-cli \
  containerd.io \
  docker-buildx-plugin \
  docker-compose-plugin

sudo systemctl enable --now docker
```

驗證：

```bash
sudo docker version
sudo docker compose version
sudo docker run --rm hello-world
```

---

## 步驟 2：建立部署使用者與目錄

```bash
sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG docker deploy

sudo install -d \
  -o deploy \
  -g deploy \
  -m 700 \
  /home/deploy/.ssh

sudo mkdir -p \
  /opt/edge \
  /opt/apps/deck/data

sudo chown -R deploy:deploy \
  /opt/edge \
  /opt/apps
```

設定防火牆（若 SSH 非 22 port，先放行實際 SSH port）：

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
sudo ufw status
```

> 之後僅 Traefik publish 80/443，應用容器本身不 publish port。

---

## 步驟 3：啟動 Traefik 路由層

```bash
sudo -iu deploy
docker network create proxy
```

```bash
cd /opt/edge
mkdir -p letsencrypt
touch letsencrypt/acme.json
chmod 600 letsencrypt/acme.json
```

建立 `.env`（可參考 [`deploy/templates/edge/.env.example`](../deploy/templates/edge/.env.example)）：

```bash
cat > /opt/edge/.env <<'EOF'
ACME_EMAIL=your-email@example.com
EOF
chmod 600 /opt/edge/.env
```

複製 compose 設定（來自 [`deploy/templates/edge/compose.yml`](../deploy/templates/edge/compose.yml)）到 `/opt/edge/compose.yml`。

啟動：

```bash
cd /opt/edge
docker compose config
docker compose up -d
docker compose ps
```

預期：`edge-traefik` 狀態為 `Up (healthy)`。

---

## 步驟 4：應用程式（已完成）

應用程式已在 repository 中實作。詳見 [DEVELOPMENT.md](./DEVELOPMENT.md)。

Repository 結構：

```text
phark/
├── backend/
├── frontend/
├── Dockerfile
├── .dockerignore
├── README.md
├── docs/
└── deploy/templates/
```

---

## 步驟 5：本機測試 Docker image

在 repository root：

```bash
docker build --progress=plain -t deck:local .

TEST_SECRET=$(openssl rand -base64 32 | tr -d '=\n' | tr '+/' '-_')
mkdir -p .local-data
# Linux permission denied 時：
# sudo chown -R 10001:10001 .local-data

docker run --rm \
  --name deck-local \
  -p 8080:8080 \
  -e APP_DB_PATH=/data/deck.db \
  -e APP_MEDIA_PATH=/data/media \
  -e SPRING_PROFILES_ACTIVE=prod \
  -e SESSION_COOKIE_SECURE=false \
  -e SERVER_FORWARD_HEADERS_STRATEGY=none \
  -e APP_ABUSE_IP_HMAC_SECRET="${TEST_SECRET}" \
  -v "$(pwd)/.local-data:/data" \
  deck:local
```

另一 terminal：

```bash
curl -fsS http://127.0.0.1:8080/actuator/health
curl -fsS http://127.0.0.1:8080/api/posts
```

瀏覽器開啟 http://127.0.0.1:8080，確認 register/login、三欄版面、authenticated
發文／回覆與 profile。`SESSION_COOKIE_SECURE=false` 只供這個本機 HTTP smoke；VPS
經 Traefik HTTPS 時不要覆寫 production profile 的 `true` 預設。

Media runtime smoke（真實 upload → read → restart → re-read；以真實 GET bytes
與 sha256sum 位元組相等為證據，不只 HEAD）：

```bash
# 以 composer 附上一張 JPEG/PNG 圖片建立 post，確認 Post.image 非 null
# 記錄傳回的 /api/media/<id>

# restart 前以真實 GET 下載 bytes，保存 baseline
curl -fsS -o /tmp/media-before.bin "http://127.0.0.1:8080/api/media/<id>"

# 重啟 container
docker restart deck-local
curl -fsS http://127.0.0.1:8080/actuator/health

# restart 後再次真實 GET，並以 sha256sum/cmp 驗證 bytes 完全一致
# （bytes 在 .local-data/media，restart 後仍在；僅 process-memory session 遺失）
curl -fsS -o /tmp/media-after.bin "http://127.0.0.1:8080/api/media/<id>"
sha256sum /tmp/media-before.bin /tmp/media-after.bin
cmp /tmp/media-before.bin /tmp/media-after.bin \
  && echo "media bytes identical across restart" || exit 1
```

Image bytes 與 SQLite 都落在單一 `.local-data`（container 內為 `/data`）：
`deck.db` 存 metadata、`media/` 存 bytes。**Restart 保留已上傳的 media bytes 與
posts**；session 儲存在 application memory，因此 restart 會登出既有使用者——這是
單 instance 架構的已知限制（見步驟 6）。

### SDD-011 濫用控制 smoke（本機與 VPS 通用）

> **本文件同步任務只改文件/模板，未執行任何部署或 smoke**；下列步驟是含 V10
> migration 的 release 上線前，由 operator 在本 image 上的驗收清單。
> 直接 publish 8080 的 smoke 必須顯式 `SERVER_FORWARD_HEADERS_STRATEGY=none`
> （避免信賴可被偽造的 forwarding headers）；上線經 Traefik 時由 prod profile
> 的 `framework` 處理、且 app port 不 publish。

使用步驟 5 已啟動的 disposable local container 與其 `TEST_SECRET` 執行下列檢查；
production secret 必須另行生成並保密。

- **Allowed / boundary / recovery**：quota 內 request 正常接受並回傳
  `RateLimit-Limit`/`RateLimit-Remaining`/`RateLimit-Reset`；耗盡後下一 request 回
  `429 RATE_LIMITED` 且 `Retry-After` = `RateLimit-Reset`；aligned window 過後
  quota 恢復。Security（401/403）response **不帶** rate-limit header。
- **Reports（valid / duplicate / invalid）**：authenticated + CSRF 對既有
  post/reply 送一個 supported reason 得 `201`（回傳含 `RECEIVED`）；同 account 對
  同 target 再送任一 reason 得 `409 DUPLICATE_REPORT`；non-positive ID、missing
  target、unsupported/missing reason 各得對應的 400/404 RFC 9457
  (`INVALID_POST_ID`/`INVALID_REPLY_ID`、`POST_NOT_FOUND`/`REPLY_NOT_FOUND`、
  `VALIDATION_FAILED`)；這些 controller-level 4xx 不寫 report/signal，但通過
  auth/CSRF 後仍會消耗一單位 `REPORT_WRITE` quota。只有 401/403 不寫 bucket。
- **Redaction**：SQLite moderation rows 應只含 keyed HMAC、不可含 raw IP；response
  body 與 `docker logs deck-local` 搜尋已知 raw IP 或 internal HMAC 必須 **0 matches**。
- **Retention**：在 disposable DB 建立符合 V10 CHECK/FK 的 expired 與 live fixtures
  後 restart；startup cleanup 應只刪除 expired rows；daily cleanup 由 `ModerationRetentionScheduler`
  於 **03:00 UTC**（cron `0 0 3 * * *`，zone UTC）執行。
- **Restart persistence**：消耗部分 quota 後 `docker restart deck-local`（同一
  volume + 同一 secret），consumed quota 在 window 結束前仍有效；SQLite 資料與
  `/data/media` bytes 不變。

> **Trust boundary**：本方案只有 Traefik publish 80/443，app port 永不被 compose
> publish；只有 Traefik 產生的 canonical client 值才會被 prod 的 forwarded-header
> handling 信賴。任何能直接連到 app 的 peer 都必須在共享 `proxy` network 的
> **trusted infrastructure boundary** 內。Traefik 模板
> （`deploy/templates/edge/compose.yml`）已設定 `forwardedHeaders.insecure=false`
> 於 web/websecure、JSON access log，並 drop `ClientAddr`/`ClientHost`/`ClientPort`、
> 全部 request headers 與 query parameters。

---

## 步驟 6：VPS 應用 Compose

建立 `/opt/apps/deck/compose.yml`（模板：[`deploy/templates/deck/compose.yml`](../deploy/templates/deck/compose.yml)）。

建立 `/opt/apps/deck/.env`：

```bash
cat > /opt/apps/deck/.env <<'EOF'
APP_DOMAIN=deck.example.com
APP_IMAGE=ghcr.io/fallrising/phark:sha-0000000000000000000000000000000000000000
APP_ABUSE_IP_HMAC_SECRET=replace-me-with-a-32-byte-unpadded-base64url-value
EOF
chmod 600 /opt/apps/deck/.env
```

`APP_ABUSE_IP_HMAC_SECRET`（SDD-011）在 production **必須**是**恰 32 bytes** 的
random **unpadded base64url** 值，且不可沿用 repository 的 dev 值或任何已提交值；
generation：

```bash
openssl rand -base64 32 | tr -d '=\n' | tr '+/' '-_'
```

缺少/malformed/short/dev 值會讓 prod profile **startup 失敗**（fail-closed）。
此 secret 是 domain-separated internal abuse signals / rate-limit subjects 的 HMAC
key：**rotation 有意的後果**是舊 HMAC 無法關聯、effective partition 重設、
舊 rows 依 retention 自然老化。Compose 模板以
`${APP_ABUSE_IP_HMAC_SECRET:?...}` 語法**要求**這個變數，`docker compose config`
在缺值時直接報錯。secret 不得進 source control 或 log。

設定 SQLite 目錄權限：

```bash
exit   # 離開 deploy 使用者

sudo chown -R 10001:10001 /opt/apps/deck/data
sudo chown deploy:deploy /opt/apps/deck
sudo chown deploy:deploy /opt/apps/deck/compose.yml
sudo chown deploy:deploy /opt/apps/deck/.env
```

**Production 資料 layout**：單一 `/data` volume（compose 的 `./data:/data`）同時
涵蓋 `deck.db`（SQLite metadata）與 `media/`（image bytes）。compose template 已
設定 `APP_MEDIA_PATH=/data/media`；`/data/media` 由容器內 app（UID 10001）在
首次寫入時自動建立，並應屬 `10001:10001`（上述 `chown -R 10001:10001 .../data`
已涵蓋）。任何權限問題用下方「常見錯誤定位」的 chown 指令修復。

```bash
sudo -iu deploy
cd /opt/apps/deck
docker compose config
```

此時**不要**執行 `up`，映像尚未推送。

Production session cookie 為 Secure、HttpOnly、SameSite=Lax，idle timeout 預設
30 分鐘。Session 儲存在 application memory，因此 deploy/restart 會登出既有
使用者；這是目前單 instance 架構的已知限制。**Restart 不會清除 SQLite 或
`/data/media` 下的 bytes**：已上傳的 posts 與 media 在 restart/upgrade 後仍保留，
只有 process-memory session 遺失。

---

## 步驟 7：VPS 登入 GHCR

GitHub Actions 發布映像使用 `GITHUB_TOKEN`；VPS 拉取私人映像需 PAT classic（scope：`read:packages`）。

```bash
sudo -iu deploy

read -rsp "GHCR token: " GHCR_TOKEN
echo

printf '%s' "$GHCR_TOKEN" \
  | docker login ghcr.io \
      -u fallrising \
      --password-stdin

unset GHCR_TOKEN
```

預期：`Login Succeeded`

---

## 步驟 8：部署腳本（含失敗回滾）

將 [`deploy/templates/scripts/deploy-deck`](../deploy/templates/scripts/deploy-deck) 安裝到 VPS：

```bash
sudo cp deploy/templates/scripts/deploy-deck /usr/local/bin/deploy-deck
sudo chmod 0755 /usr/local/bin/deploy-deck
sudo chown root:root /usr/local/bin/deploy-deck
```

腳本行為：

1. 驗證 image 格式（`ghcr.io/...:sha-<40位commit>`）
2. 檔案鎖防止並行部署
3. 備份 `.env` → 更新 `APP_IMAGE` → `docker compose pull` → `up --wait`
4. 失敗時自動恢復舊 image 並重啟
5. 記錄到 `/opt/apps/deck/deploy-history.log`

---

## 步驟 9：限制 GitHub Actions SSH key

在本機產生部署專用 key（**不要 commit**）：

```bash
ssh-keygen \
  -t ed25519 \
  -f github-deck-deploy \
  -C "github-actions-deck-deploy" \
  -N ""
```

安裝 SSH wrapper（模板：[`deploy/templates/scripts/deploy-deck-ssh`](../deploy/templates/scripts/deploy-deck-ssh)）：

```bash
sudo cp deploy/templates/scripts/deploy-deck-ssh /usr/local/bin/deploy-deck-ssh
sudo chmod 0755 /usr/local/bin/deploy-deck-ssh
sudo chown root:root /usr/local/bin/deploy-deck-ssh
```

設定 `authorized_keys`（將 `AAAA...` 替換為 `github-deck-deploy.pub` 內容，維持單行）：

```bash
sudo tee /home/deploy/.ssh/authorized_keys >/dev/null <<'EOF'
command="/usr/local/bin/deploy-deck-ssh",no-agent-forwarding,no-port-forwarding,no-X11-forwarding,no-pty,no-user-rc ssh-ed25519 AAAA... github-actions-deck-deploy
EOF

sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys
sudo chmod 600 /home/deploy/.ssh/authorized_keys
```

此 key 只能執行 `deploy ghcr.io/...:sha-<commit>`，無法取得互動 shell。

---

## 步驟 10：GitHub Production Environment 與 Secrets

Repository → **Settings → Environments → New environment → `production`**

新增 secrets：

| Secret | 內容 |
|--------|------|
| `VPS_HOST` | VPS IP 或 SSH domain |
| `VPS_USER` | `deploy` |
| `VPS_SSH_PRIVATE_KEY` | `github-deck-deploy` 完整私鑰 |
| `VPS_KNOWN_HOSTS` | 從 VPS 讀取的 host key（見下方） |

取得 `VPS_KNOWN_HOSTS`（在 VPS 上執行）：

```bash
VPS_HOST="203.0.113.10"

printf '%s %s\n' \
  "${VPS_HOST}" \
  "$(sudo cut -d' ' -f1-2 /etc/ssh/ssh_host_ed25519_key.pub)"
```

將整行存入 `VPS_KNOWN_HOSTS`。

---

## 步驟 11：加入 GitHub Actions

將 [`deploy/templates/github/workflows/ci-cd.yml`](../deploy/templates/github/workflows/ci-cd.yml) 複製到 repository：

```bash
mkdir -p .github/workflows
cp deploy/templates/github/workflows/ci-cd.yml .github/workflows/ci-cd.yml
git add .github/workflows/ci-cd.yml
git commit -m "Add CI/CD workflow"
git push origin master
```

設計要點：

- PR 只 build，不 push、不 deploy
- push 到 `master` 才發布映像到 GHCR
- 同時打 `sha-<commit>` 與 `latest` tag
- production 永遠部署 `sha-<commit>`，不用 `latest`
- deploy concurrency = 1
- 直接使用 OpenSSH，不用第三方 SSH action

> 路徑打通後，建議將 Actions 固定到完整 commit SHA 以確保不可變引用。

---

## 步驟 12：設定 DNS

為 domain 建立 A record：

```text
deck.example.com → VPS_PUBLIC_IPV4
```

確認：

```bash
dig +short deck.example.com
```

80 與 443 必須直接到達 Traefik，才能用 ACME HTTP challenge 簽發憑證。

---

## 步驟 13：第一次 push 與驗收

```bash
git push origin master
```

GitHub Actions 應顯示 `Build container image` 與 `Deploy production` 成功。

VPS 檢查：

```bash
sudo -iu deploy
cd /opt/apps/deck
docker compose ps
docker compose logs --tail=100 app
```

外部驗收：

```bash
curl -I https://deck.example.com
curl -fsS https://deck.example.com/actuator/health
curl -fsS https://deck.example.com/api/posts
```

預期：`HTTP/2 200` 與 `{"status":"UP"}`。

部署歷史：

```bash
cat /opt/apps/deck/deploy-history.log
```

---

## 暫時沒有 domain 的測試方式

在 app compose 暫時加入：

```yaml
ports:
  - "127.0.0.1:18080:8080"
```

從本機建立 SSH tunnel：

```bash
ssh -L 18080:127.0.0.1:18080 your-admin-user@YOUR_VPS_IP
```

瀏覽器開啟 http://127.0.0.1:18080

取得 domain 後移除 `ports`，讓外部流量只經 Traefik。

---

## 常見錯誤定位

### GitHub Actions `denied` / `unauthorized`

```bash
sudo -iu deploy
docker login ghcr.io
docker pull ghcr.io/fallrising/phark:latest
```

確認 PAT 有 `read:packages` 且 package 存取權正確。

### HTTPS 404

```bash
grep APP_DOMAIN /opt/apps/deck/.env
dig +short deck.example.com
docker inspect deck-app --format '{{json .Config.Labels}}'
```

### HTTPS 502

```bash
docker logs --tail=200 deck-app
docker inspect deck-app --format '{{json .State.Health}}'
```

### SQLite / media `permission denied`

```bash
sudo chown -R 10001:10001 /opt/apps/deck/data
sudo chmod 755 /opt/apps/deck/data

# media 寫入失敗時（`/data/media` 由 app 以 UID 10001 建立），確認同樣屬主：
sudo ls -ld /opt/apps/deck/data/media
sudo chown -R 10001:10001 /opt/apps/deck/data/media
```

### 憑證未簽發

```bash
docker logs edge-traefik 2>&1 | grep -iE 'acme|certificate|challenge|error'
sudo ss -lntp | grep -E ':80|:443'
dig +short deck.example.com
```

### 手動測試部署腳本

```bash
docker image ls ghcr.io/fallrising/phark

/usr/local/bin/deploy-deck \
  ghcr.io/fallrising/phark:sha-YOUR_40_CHAR_COMMIT_SHA
```

---

## 第一輪完成標準

```text
[ ] docker compose version 成功
[ ] edge-traefik 顯示 healthy
[ ] 本機 docker build 成功
[ ] 本機 /actuator/health 返回 UP
[ ] push master 後 GHCR 出現 sha-<commit> image
[ ] GitHub deploy job 成功
[ ] VPS deck-app 顯示 healthy
[ ] https://deck.example.com 可訪問
[ ] SQLite 新增文章後，重啟 container 資料仍存在
[ ] 故意部署無法啟動的版本時，腳本能恢復舊 image
```

完成後執行並保留輸出，作為下一輪（備份、middleware、監控）的起點：

```bash
docker compose version
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
curl -fsS https://deck.example.com/actuator/health
```

## 下一輪規劃

- SQLite 自動備份（`sqlite3 ".backup"` + systemd timer + restic）
- Traefik middleware（rate limit、security headers）
- 部署通知
- 基本監控
