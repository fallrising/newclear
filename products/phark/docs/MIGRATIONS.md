# Schema Migration Production Runbook

> 適用於 deck 應用（`deck` Compose project），基於 Flyway + SQLite。
> 最後更新：2026-09-04

---

## 不可變 Migration 撰寫規則

1. **Forward-only**：不撰寫 `undo` 或 `down` migration。已發布的 versioned migration
   視為 immutable，任何修正必須使用**新版本號**。
2. **命名格式**：`V<version>__<description>.sql`，置於
   `backend/src/main/resources/db/migration/`。
3. **Fail closed**：migration 預設應在 schema 與預期不符時失敗，不可為了讓
   部署通過而全面加入 `IF NOT EXISTS`。只有像 V2/V3 這類明確支援
   pre-Flyway schema、且有 upgrade tests 的相容橋接才可使用 idempotent DDL。
4. **不依賴 application code**：migration 只使用純 SQL，不得呼叫 Java repository
   或 service。
5. **不修改已發布 migration**：即使只改註解或空白，也會觸發 Flyway checksum
   驗證失敗。修正永遠走新版本。
6. **驗證**：本地執行 `docker build` 與 backend integration tests；CI 套用所有
   migration 到新的暫存 SQLite 以確認順序正確。

---

## 前置檢查與必要條件

```bash
# 安裝並確認 sqlite3 CLI（用於 backup、history 與 integrity check）
sudo apt-get update
sudo apt-get install -y sqlite3
sqlite3 --version

# 確認可寫入備份目錄
sudo install -d \
  -o deploy \
  -g deploy \
  -m 755 \
  /opt/apps/deck/backups

# 確認目前 compose project 狀態
sudo -iu deploy

cd /opt/apps/deck
docker compose ps
```

預期 `deck-app` **Up (healthy)**。

記錄目前映像供回滾參考：

```bash
APP_IMAGE_OLD=$(docker inspect deck-app \
  --format '{{index .Config.Image}}')
echo "${APP_IMAGE_OLD}"
```

---

## 步驟 1：停止應用（單一 instance，無 rolling update）

```bash
docker compose stop --timeout 30 app
```

確認 container 已停止，不再持有 SQLite 寫入鎖：

```bash
docker compose ps --all
# deck-app 應顯示 Exited
```

---

## 步驟 2：建立同一 release snapshot（DB + media，共同 timestamp）

> 停機後 `data/` 內可能同時有 SQLite 檔案（`deck.db` 及 WAL/SHM）與 media
> directory。SDD-010（V9）之後，SQLite 存 `post_images` **metadata**，image bytes
> 存在 `${APP_MEDIA_PATH}`（production 為 `/data/media`）——因此 DB 與 media 必須
> 視為**同一個 release snapshot**：共用同一個 `TS`、寫入同一份 manifest，且
> **雙邊都驗證通過後才准許進行部署**。只有 DB backup、或只有 media snapshot，
> 都不構成可回滾 snapshot。

```bash
TS=$(date -u +%Y%m%dT%H%M%SZ)
DATA_DIR="/opt/apps/deck/data"
BACKUP_DIR="/opt/apps/deck/backups"
BACKUP_FILE="${BACKUP_DIR}/deck-${TS}.db"
MEDIA_ARCHIVE_PATH="${BACKUP_DIR}/deck-${TS}-media.tar.gz"
MANIFEST_FILE="${BACKUP_DIR}/deck-${TS}.restore.env"

# 0) 前置：拒絕覆寫同一 TS 的既有 backup / media archive / manifest。三者固定由
#    TS 命名；TS 是 timestamp，重複代表同一 snapshot 已存在，覆寫會失去可回滾現場。
#    失敗後重跑請換新的 TS（timestamp 一定不同）。
for TARGET in "${BACKUP_FILE}" "${MEDIA_ARCHIVE_PATH}" "${MANIFEST_FILE}"; do
  if [ -e "${TARGET}" ]; then
    echo "ERROR: ${TARGET} already exists; pick a new TS, do not overwrite." >&2
    exit 1
  fi
done

# 1) 前置：media 頂層要嘛不存在（V8 來源）、要嘛是 real directory。symlink 或
#    非 directory 的 media 頂層一律拒絕 snapshot——`tar -C` 並不單獨構成
#    symlink-escape 防禦，snapshot 前先驗證 real directory 是硬前提，避免留下
#    部分 backup。
if sudo test -L "${DATA_DIR}/media" \
   || { sudo test -e "${DATA_DIR}/media" && ! sudo test -d "${DATA_DIR}/media"; }; then
  echo "ERROR: ${DATA_DIR}/media is a symlink or not a real directory; abort snapshot." >&2
  exit 1
fi

# 2) SQLite 一致性 snapshot（Online Backup API，不需 VACUUM 或檔案複製）；
#    失敗立即中止，不留下不完整的 backup。
sudo sqlite3 "${DATA_DIR}/deck.db" ".backup '${BACKUP_FILE}'" \
  || { echo "ERROR: SQLite backup failed; abort snapshot." >&2; exit 1; }

# 3) media directory snapshot——與 DB 同一 TS；V8 來源可能尚無 media dir，
#    此時如實記錄 MEDIA_PRESENT=no / MEDIA_ARCHIVE=none（media 存在時必為
#    real directory，前置檢查已保證）。
if sudo test -d "${DATA_DIR}/media"; then
  sudo tar -czf "${MEDIA_ARCHIVE_PATH}" -C "${DATA_DIR}" media \
    || { echo "ERROR: media archive failed; abort snapshot." >&2; exit 1; }
  MEDIA_PRESENT=yes
  MEDIA_ARCHIVE="${MEDIA_ARCHIVE_PATH}"
else
  MEDIA_PRESENT=no
  MEDIA_ARCHIVE=none
fi
```

**說明**：`.backup` 使用 SQLite Online Backup API 產生一致性 snapshot。media 以
`sudo tar` 讀取 UID 10001 擁有的檔案，`-C "${DATA_DIR}"` 只引用 `media` 單一頂層
成員。**`-C` 本身不構成 symlink-escape 防禦**：真正的防禦是在 snapshot 前先驗證
`media` 是 real directory（非 symlink）——封存端 GNU tar 依預設不追蹤 symlink
（symbolic link 以 link 形式存入 archive），解開端拒絕絕對路徑與 `..`，但不依賴
`-C` 單點防禦。**封存端不須、也不使用 `--same-owner`**：`--same-owner` 是**解開端**
選項，對建立 archive 無意義。GNU tar 建立 archive 時（root 執行）依預設即記錄每個
檔案的 owner/group name 與 numeric UID/GID，不需任何 flag。解開端以 root +
`--same-owner` 明確套用 archive 內記錄的 UID/GID（10001）；非 root 解開時捨棄記錄的
ownership、以目前使用者為 owner。`MEDIA_PRESENT=no` 代表該 snapshot 不含 media
archive（V8→V9 升級前無 `/data/media` 屬正常），manifest 如實記錄 `MEDIA_ARCHIVE=none`。

### 驗證同一 snapshot 雙邊完整

```bash
# DB：integrity must be ok（fail-closed：不是 ok 就中止，不進入部署）
if [ "$(sudo sqlite3 "${BACKUP_FILE}" "PRAGMA integrity_check;")" != "ok" ]; then
  echo "ERROR: DB backup integrity_check is not ok; abort." >&2
  exit 1
fi

# media（若存在）：確認 archive 可讀且含頂層 media/ 目錄
if [ "${MEDIA_PRESENT}" = "yes" ]; then
  sudo tar -tzf "${MEDIA_ARCHIVE_PATH}" >/dev/null \
    || { echo "ERROR: media archive is unreadable; abort." >&2; exit 1; }
  sudo tar -tzf "${MEDIA_ARCHIVE_PATH}" | grep -qx 'media/' \
    || { echo "ERROR: media archive missing top-level media/ member; abort." >&2; exit 1; }
fi
```

預期：DB integrity 輸出 `ok`、media archive 頂層清單含 `media/`。**雙邊驗證都
通過後才准許進入步驟 3。**

把本次復原資訊連同 media 標記寫到與備份相同的持久目錄（不依賴 `/tmp`，SSH
中斷可續）：

```bash
for F in "${BACKUP_FILE}" "${MEDIA_ARCHIVE_PATH}"; do
  if [ -e "${F}" ]; then
    sudo chown deploy:deploy "${F}"
  fi
done

{
  printf 'TS=%q\n' "${TS}"
  printf 'APP_IMAGE_OLD=%q\n' "${APP_IMAGE_OLD}"
  printf 'BACKUP_FILE=%q\n' "${BACKUP_FILE}"
  printf 'MEDIA_PRESENT=%q\n' "${MEDIA_PRESENT}"
  printf 'MEDIA_ARCHIVE=%q\n' "${MEDIA_ARCHIVE}"
} > "${MANIFEST_FILE}"
```

`deck-<timestamp>.restore.env` 是該次 snapshot 的 **manifest**：`TS`、DB backup、
media archive（或 `none`）與舊 image 都記錄在同一處。Rollback 只整組還原，不會
只還原其中一邊。

---

## 步驟 3：指定並部署新映像

```bash
NEW_IMAGE="ghcr.io/fallrising/phark:sha-<40-hex-commit>"

printf 'Old image: %s\nNew image: %s\nDB backup: %s\nMedia archive: %s\n' \
  "${APP_IMAGE_OLD}" "${NEW_IMAGE}" "${BACKUP_FILE}" "${MEDIA_ARCHIVE}"

/usr/local/bin/deploy-deck "${NEW_IMAGE}"
```

`deploy-deck` 會安全更新既有 `.env` 的 `APP_IMAGE`，不會覆蓋 `APP_DOMAIN`。
**只在步驟 2 的 DB 與 media 雙邊驗證都通過後才執行本步驟。** 腳本失敗時會嘗試
重啟舊 image；只要本次 release 含 migration，仍須立即執行下方「失敗處理」，因為
image rollback 不會還原 schema，V9 之後還必須連同 media snapshot 一起還原。

---

## 步驟 4：驗證

### 容器健康

```bash
docker compose ps
# deck-app 應顯示 Up (healthy)

docker inspect deck-app \
  --format '{{json .State.Health.Status}}'
# 預期: "healthy"
```

### 應用存活

```bash
docker exec deck-app \
  curl -fsS http://127.0.0.1:8080/actuator/health
# 預期: {"status":"UP"}
```

Compose 不 publish port 8080 到 host；因此本機 health check 從 container 內執行。
外部驗收另經 Traefik 執行：

```bash
APP_DOMAIN=$(sed -n 's/^APP_DOMAIN=//p' /opt/apps/deck/.env)
curl -fsS "https://${APP_DOMAIN}/actuator/health"
```

### Migration History

```bash
sudo sqlite3 /opt/apps/deck/data/deck.db \
  "SELECT version, description, installed_on, success
   FROM flyway_schema_history
   ORDER BY installed_rank;"
```

Runtime image 刻意不安裝 `sqlite3`；history 一律使用 host CLI 查詢掛載的 database。
所有 migration 的 `success` 欄位應為 `1`。若版本號與預期不符，表示
baseline 或 migration 順序有落差。

SDD-007 release 的預期 latest version 是 V6 `add post reposts`。SDD-008
（notifications）release 的預期 latest version 是 V7 `add notifications`，兩張新
table 都不回填既有資料。SDD-009（search）release 的預期 latest version 是 V8
`add post search`。**SDD-010（media attachments）release 的預期 latest version
是 V9 `add post images`——V9 是該 release 的最新 migration；**目前的
最新 migration 是 V10 `add moderation controls`（SDD-011，見下方 V10 段落）**。V4 新增
`accounts`、nullable `posts.author_account_id`、nullable
`replies.author_account_id` 與對應 indexes。升級 V3 或 legacy baseline 時不得依
`author` 字串建立 account；所有既有 ownership 必須保持 `NULL`，既有 row、ID、
timestamp 與 author snapshot 必須保留。

V5 只新增 `post_likes`，其 composite primary key 是 `(post_id, account_id)`；兩個
foreign keys 分別指向 posts/accounts 並使用 `ON DELETE CASCADE`。從 populated V4
升級時 accounts、owned posts/replies、IDs 與 timestamps 都必須保留，且新 table
必須為空。回滾 V5 application image 時仍需同時還原部署前 database backup；舊 image
不認識 V5 schema，不能只切回 image 就宣稱 rollback 完成。

V6 只新增 `post_reposts`，使用 surrogate `id`（AUTOINCREMENT）作為 timeline
activity identity，`(post_id, account_id)` UNIQUE constraint 保證每帳號對每原文
只有一筆 relation，兩個 foreign keys 使用 `ON DELETE CASCADE`。從 populated V5 升級時
所有既有的 accounts、posts、likes、IDs 與 timestamps 都必須保留，且新 table 必須為空。
V6 建立兩個 named indexes：`idx_post_reposts_timeline`（`created_at DESC, id
DESC`）支援 shared feed ordering；`idx_post_reposts_account_timeline`（`account_id,
created_at DESC, id DESC`）支援 profile feed。Mixed timeline query 使用 bounded
`UNION ALL` 合併 original 與 repost branch，最大 page size 為 100。回滾 V6
application image 時仍需同時還原部署前 database backup；舊 image 不認識 V6 schema，
不能只切回 image 就宣稱 rollback 完成。不手動 DELETE flyway_schema_history rows。

V7 是 SDD-008（notifications）的 migration，新增 `notifications` 與
`notification_read_state` 兩個 table。`notifications` 使用 AUTOINCREMENT `id`、
`UNIQUE(reply_id)`、CHECK（REPLY 必有 reply_id，LIKE/REPOST 為 null）與 named
index `idx_notifications_recipient_page (recipient_account_id, id DESC)`；
actor/recipient/post/reply 都使用 `ON DELETE CASCADE` foreign keys。
`notification_read_state` 以 `account_id` 為 primary key，保存 non-negative
`read_through_id`，不 foreign-key 到 notifications，避免 retention 刪除 boundary
row 時破壞 read state。V7 **不回填**任何既有 replies/likes/reposts，部署當下兩張新
table 都為空；從 populated V6 升級時所有既有的 accounts、posts、replies、likes、
reposts、IDs 與 timestamps 都必須保留，notification 資料只會從部署後的新互動開始
累積。回滾 V7 application image 時仍需同時還原部署前 database backup；舊 image 不
認識 V7 schema，不能只切回 image 就宣稱 rollback 完成。

V8 是 SDD-009（search）的 migration，新增 **external-content FTS5 virtual table**
`search_posts`（`content='posts'`、`content_rowid='id'`、
`tokenize='unicode61 remove_diacritics 2'`）。這是**全量回填** migration（與 V5–V7 的
新表為空不同）：migration 內部的 `INSERT INTO search_posts(search_posts)
VALUES('rebuild')` 在 migration-time 把全部既有 original posts.content 建成索引，
因此部署完成後既有原文立即可被搜尋；`posts` 仍是 source of truth，FTS table 只保存
index 與 mirror `posts.id` 的 rowid。三個 trigger（`posts_search_ai` AFTER INSERT、
`posts_search_ad` AFTER DELETE、`posts_search_au` AFTER UPDATE OF content）與 posts
mutation 同一 transaction，任一 trigger 失敗 rollback 整個 post 寫入（fail-closed），
不會留下部分狀態。從 populated V7 升級時所有既有的 accounts、posts、replies、likes、
reposts、notifications、IDs 與 timestamps 都必須保留；replies 不索引。

V9 是 SDD-010（media attachments）的 migration，新增 one-to-one metadata table
`post_images`（`post_id NOT NULL UNIQUE REFERENCES posts(id) ON DELETE CASCADE`、
`storage_key NOT NULL UNIQUE`、strict CHECK 的 content_type/byte_size/width/height/
sha256 與 `width * height <= 12000000`）。SQLite **只存 metadata、不存 bytes**：
image bytes 在 `/data/media`（`${APP_MEDIA_PATH}`）。V9 **不回填**：既有 V1–V8
posts 的 `image` 都是 null，部署當下 `post_images` 為空。從 **populated V8** 升級
時所有既有的 accounts、posts、replies、likes、reposts、notifications、IDs 與
timestamps 都必須逐項保留，`post_images` 必須維持空表（此為立即的 V8→V9 checkpoint
預期；後續從已 populated 來源升級的 release 必須先量測部署前 `post_images` row count、
部署後保證一致，不得再假定為 0）。FK `ON DELETE CASCADE` 只刪
`post_images` metadata row，**永不**刪除 `/data/media` 下的 filesystem bytes；
unreferenced bytes 由下方「步驟 6」的 stopped-app reconciliation 清理，DB 層不負責
刪檔。V9 與 V1–V8 及其 Flyway history 一律 immutable：不編輯任何已發布 migration
檔案、不手動 DELETE `flyway_schema_history` rows、不執行 `flyway repair` 或
`flyway clean`；任何修正走新版本。

部署後檢查（應用已健康、無進行中寫入）：

```bash
sudo sqlite3 /opt/apps/deck/data/deck.db "PRAGMA integrity_check;"
# 預期: ok

sudo sqlite3 /opt/apps/deck/data/deck.db \
  "SELECT type, name FROM sqlite_master
   WHERE name IN ('search_posts','posts_search_ai','posts_search_ad','posts_search_au');"
# 預期: search_posts 的 type 為 table，三個 trigger 的 type 為 trigger
```

V9 部署後檢查（應用已健康、無進行中寫入）：

```bash
# latest history row 必須是 V9，且 success = 1
sudo sqlite3 /opt/apps/deck/data/deck.db \
  "SELECT version, description, success FROM flyway_schema_history
   ORDER BY installed_rank DESC LIMIT 1;"
# 預期: 9|add post images|1

# post_images 存在（V9 不回填）
sudo sqlite3 /opt/apps/deck/data/deck.db \
  "SELECT type, name FROM sqlite_master WHERE type = 'table' AND name = 'post_images';"
# 預期: table|post_images

# 立即的 V8→V9 no-write checkpoint（升級前尚無 post_images 可參照）預期是 0；
# 之後的 release 必須先量測部署前 row count、部署後保證一致，不得再要求 0。
sudo sqlite3 /opt/apps/deck/data/deck.db \
  "SELECT COUNT(*) FROM post_images;"
# 預期（僅指 V9 從 V8 部署當下的 checkpoint）: 0（既有 V1–V8 posts 的 image 都是 null）

sudo sqlite3 /opt/apps/deck/data/deck.db \
  "SELECT COUNT(*) FROM posts;"
# 預期: >= 0 且與升級前 count 一致（populated V8→V9 保留既有資料）

sudo sqlite3 /opt/apps/deck/data/deck.db "PRAGMA integrity_check;"
# 預期: ok
```

V10 是 SDD-011（moderation and abuse controls）的 migration，新增三張 internal-only
table：`abuse_rate_limit_buckets`（restart-persistent fixed-window 計數器：composite
PK `(scope, subject_kind, subject_hmac, window_start_epoch)`、CHECK 的
scope/subject_kind 辭彙、`subject_hmac` lowercase 64-hex、`request_count > 0`、
`window_end > window_start`、`expires_at = window_end + 86400`、REGISTER/LOGIN 只限
IP）、`content_reports`（reporter account FK、`target_type` POST/REPLY、exactly one
nullable post/reply FK、reason CHECK、status 只有 `RECEIVED`、created/expiry）與
`abuse_signals`（非 null actor FK、依 action_kind CHECK 恰有一個 post/reply/report
FK、`ip_hmac` lowercase 64-hex、created/expiry），外加 expiry retention indexes、
partial unique indexes（每 reporter 每 post / 每 reporter 每 reply 至多一筆 retained
report；每新 post/reply/report 至多一筆 origin/intake signal）與 IP/actor 時間
index。V10 **完全 additive、不回填**：legacy post/reply 的歷史 IP origin 未知，
刻意不製造假信號，legacy content 仍可被檢舉。**clean V1→V10 與 populated V9→V10
（含非空 `post_images`）都是釋出前必需證據**；既有 accounts、posts、replies、likes、
reposts、notifications、search_posts（FTS）、`post_images` rows 與 `/data/media`
bytes 逐項保留。所有 FK 與 `ON DELETE` 都明確；dependent moderation rows
（reports/signals）使用 `ON DELETE CASCADE`，rate bucket 無 FK；**任何 moderation
table 都不會 cascade 刪除 accounts、posts、replies、interactions、notifications 或
media**。V10 失敗必須留下 V9 history 與既有物件 intact（fail-closed）。Rollback 仍是
backup restore（下方「步驟 5」）：還原 pre-V10 的 DB + media snapshot 與舊 Docker
image；舊 image 搭配已 migrate 的 V10 schema 是不支援組合。V10 與 V1–V9 一律 immutable：
不編輯已發布 migration、不手動 DELETE flyway_schema_history rows、不執行
`flyway repair`/`flyway clean`。

V10 部署後檢查（應用已健康、無進行中寫入）：

```bash
# latest history row 必須是 V10，且 success = 1
sudo sqlite3 /opt/apps/deck/data/deck.db \
  "SELECT version, description, success FROM flyway_schema_history
   ORDER BY installed_rank DESC LIMIT 1;"
# 預期: 10|add moderation controls|1

# 三張新 table 存在（V10 不回填；部署當下皆空表）
sudo sqlite3 /opt/apps/deck/data/deck.db \
  "SELECT type, name FROM sqlite_master
   WHERE type = 'table'
     AND name IN ('abuse_rate_limit_buckets','content_reports','abuse_signals');"
# 預期: table|abuse_rate_limit_buckets / table|content_reports / table|abuse_signals

sudo sqlite3 /opt/apps/deck/data/deck.db \
  "SELECT (SELECT COUNT(*) FROM abuse_rate_limit_buckets)
       || '|' || (SELECT COUNT(*) FROM content_reports)
       || '|' || (SELECT COUNT(*) FROM abuse_signals);"
# 預期: 0|0|0（部署後才開始累積 quota/report/signal 資料）

sudo sqlite3 /opt/apps/deck/data/deck.db \
  "SELECT COUNT(*) FROM posts;"
# 預期: >= 0 且與升級前 count 一致（populated V9→V10 保留既有資料）

sudo sqlite3 /opt/apps/deck/data/deck.db "PRAGMA integrity_check;"
# 預期: ok
```

FTS5 外部內容的一致性驗證是 write-like command，必須在**應用停止、無任何寫入**時
執行；這是 shipped migration test（`SchemaMigrationConfigTest`）使用的同一
integrity-check，不是一般 row count/JOIN 可比（那些只讀 content projection，不能證明
FTS index 已回填）：

```bash
sudo -iu deploy
cd /opt/apps/deck
docker compose stop --timeout 30 app

sudo sqlite3 /opt/apps/deck/data/deck.db \
  "INSERT INTO search_posts(search_posts, rank) VALUES('integrity-check', 1);"
# 成功時無輸出；FTS index 與 posts content 不一致時 SQLite 會回報錯誤

# 重新啟動並確認健康
docker compose up -d --no-deps --wait --wait-timeout 90 app
docker compose ps            # deck-app 應顯示 Up (healthy)
docker exec deck-app \
  curl -fsS http://127.0.0.1:8080/actuator/health   # 預期: {"status":"UP"}
```

FTS maintenance 同樣只在應用停止、無寫入時執行：以 host sqlite3 執行 `INSERT INTO
search_posts(search_posts) VALUES('optimize');` 合併 index segments，完成後重新
啟動。**不得**在應用仍有寫入時執行 `rebuild`/`optimize`/`integrity-check`。V8 與其
trigger/Flyway history 都是 immutable：不手動編輯 `V8__add_post_search.sql`、不手動
DELETE flyway_schema_history rows、不執行 `flyway repair` 或 `flyway clean`；任何修正
走新版本。回滾 V8 application image 時**必須**同時還原部署前 database backup：image
rollback 不會復原 forward migration，舊 image 搭配已 migration 的 V8 schema 是未驗證、
不支援的組合。殘留的 `search_posts` trigger 本身可獨立繼續執行（仍會同步 FTS），但
這不保證舊 image 在新 schema 上的行為；schema 回滾一律要求與 pre-upgrade 相符的 DB
backup，不能只切回 image 就宣稱 rollback 完成。

---

## 步驟 5：失敗處理

> **鐵則**：從不執行 `flyway clean`、`flyway repair` 或 `rm -rf`；V9 之後也
> **從不做 DB-only rollback**——DB 與 media 必須從同一個 manifest 成對還原。
> 失敗只走備份還原。

### 5a. 載入 manifest 並 preflight（先於任何 live 搬移）

```bash
# SSH 重連後先載入該次部署的實際 manifest（同一個 TS）；同 session 內變數已在。
# . /opt/apps/deck/backups/deck-<timestamp>.restore.env
DATA_DIR="/opt/apps/deck/data"
BACKUP_DIR="/opt/apps/deck/backups"

# preflight 1：DB backup 必須完整——先驗證 backup 本身，再動任何 live 檔案
if [ "$(sudo sqlite3 "${BACKUP_FILE}" "PRAGMA integrity_check;")" != "ok" ]; then
  echo "ERROR: DB backup integrity_check is not ok; abort rollback." >&2
  exit 1
fi

# preflight 2：MEDIA_PRESENT 與 MEDIA_ARCHIVE 必須一致，且 media archive 可讀、
#    含預期頂層成員。任何不一致（yes 卻 none/不可讀、no 卻有 archive 路徑）都拒絕。
case "${MEDIA_PRESENT}" in
  yes)
    if [ "${MEDIA_ARCHIVE}" = "none" ] \
       || [ ! -f "${MEDIA_ARCHIVE}" ] || [ ! -r "${MEDIA_ARCHIVE}" ]; then
      echo "ERROR: MEDIA_PRESENT=yes but MEDIA_ARCHIVE is not a readable file; abort." >&2
      exit 1
    fi
    sudo tar -tzf "${MEDIA_ARCHIVE}" >/dev/null \
      || { echo "ERROR: media archive is unreadable; abort." >&2; exit 1; }
    sudo tar -tzf "${MEDIA_ARCHIVE}" | grep -qx 'media/' \
      || { echo "ERROR: media archive missing top-level media/ member; abort." >&2; exit 1; }
    ;;
  no)
    if [ "${MEDIA_ARCHIVE}" != "none" ]; then
      echo "ERROR: MEDIA_PRESENT=no but MEDIA_ARCHIVE is not none; inconsistent manifest; abort." >&2
      exit 1
    fi
    ;;
  *)
    echo "ERROR: MEDIA_PRESENT must be 'yes' or 'no'; abort rollback." >&2
    exit 1
    ;;
esac
```

只有 preflight 全數通過後，才准許搬移 live 狀態（5b）與還原（5c）。

### 5b. 停止應用、保留失敗現場（DB 與 media 都移出）

```bash
docker compose stop --timeout 30 app

FAIL_DIR="${BACKUP_DIR}/failed-${TS}"

# 在移動任何 live DB file 之前先驗證 media root；否則錯誤 root 會造成半套搬移。
if [ -L "${DATA_DIR}/media" ] \
   || { [ -e "${DATA_DIR}/media" ] && [ ! -d "${DATA_DIR}/media" ]; }; then
  echo "ERROR: ${DATA_DIR}/media is a symlink or not a real directory; abort rollback." >&2
  exit 1
fi

# 拒絕沿用已存在的 failure 目錄（可能殘留上次同 TS 的現場，避免覆寫）；
# 固定使用新的 timestamped 目錄，保持現場可復原。
if [ -e "${FAIL_DIR}" ]; then
  echo "ERROR: ${FAIL_DIR} already exists; pick a new TS, do not reuse." >&2
  exit 1
fi
sudo install -d -o deploy -g deploy -m 700 "${FAIL_DIR}"

# 移出而非刪除；restore 前 data/ 不可殘留舊 WAL/SHM（failure 目錄全新、無同名檔）。
for FILE in deck.db deck.db-wal deck.db-shm; do
  if [ -e "${DATA_DIR}/${FILE}" ]; then
    sudo mv "${DATA_DIR}/${FILE}" "${FAIL_DIR}/${FILE}"
  fi
done

# 移出失敗的 media directory（若有）——與 DB 同屬可復原的 failure 現場
if [ -d "${DATA_DIR}/media" ]; then
  sudo mv "${DATA_DIR}/media" "${FAIL_DIR}/media"
fi

sudo chown -R deploy:deploy "${FAIL_DIR}"

echo "Failed DB and media preserved at: ${FAIL_DIR}"
```

### 5c. 還原同一 snapshot（DB + media 一起）

```bash
# DB
sudo install \
  -o 10001 \
  -g 10001 \
  -m 640 \
  "${BACKUP_FILE}" \
  "${DATA_DIR}/deck.db"

sudo sqlite3 "${DATA_DIR}/deck.db" "PRAGMA integrity_check;"
# 預期: ok

# media——manifest 記載 MEDIA_PRESENT=yes 才還原；V8 來源（no）安全跳過。
# --same-owner（root 執行）套用 archive 內記錄的 UID/GID（10001），再 chown 保險。
if [ "${MEDIA_PRESENT}" = "yes" ]; then
  sudo install -d -o 10001 -g 10001 -m 755 "${DATA_DIR}/media"
  sudo tar -xzf "${MEDIA_ARCHIVE}" -C "${DATA_DIR}" --same-owner
  sudo chown -R --no-dereference 10001:10001 "${DATA_DIR}/media"
fi
```

**說明**：DB 與 media 從**同一個 manifest**（同一個 `TS`）成對還原，不會出現
「DB 已 migrate 到 V9 但 media 是舊的」或反之的分裂狀態。還原後 `data/` 只含
`deck.db` 與（若 `MEDIA_PRESENT=yes`）`media/`；SQLite 會在啟動時建立對應的新
WAL/SHM。

### 5d. 回滾映像

```bash
# 還原 .env 中的 APP_IMAGE
sed -i "s|^APP_IMAGE=.*|APP_IMAGE=${APP_IMAGE_OLD}|" \
  /opt/apps/deck/.env

# 重新部署舊映像
docker compose pull app
docker compose up \
  -d \
  --no-deps \
  --wait \
  --wait-timeout 90 \
  app
```

### 5e. 最終驗證

```bash
docker compose ps
docker exec deck-app \
  curl -fsS http://127.0.0.1:8080/actuator/health
sudo sqlite3 "${DATA_DIR}/deck.db" \
  "SELECT name
   FROM sqlite_master
   WHERE type = 'table' AND name = 'flyway_schema_history';"
```

若備份建立於第一次導入 Flyway 之前，restore 後沒有 history table 是預期結果；
舊 image 必須恢復健康，且 posts/replies 資料必須仍可讀。V9 來源的 rollback 完成後，
以 `GET /api/media/{id}` 做**真實 GET bytes（非 HEAD）**回讀 smoke，並與 media
archive 中同一檔案做 `sha256sum` 位元組相等比較，確認還原的 media bytes 一致：

```bash
# 從 archive 抽樣同一檔案（以實際 strict grammar storage key 取代 <storage-key>）
ARCHIVE_SHA=$(sudo tar -xOzf "${MEDIA_ARCHIVE}" "media/<storage-key>" | sha256sum)
RESTORED_SHA=$(docker exec deck-app \
  curl -fsS "http://127.0.0.1:8080/api/media/<id>" | sha256sum)
[ "${ARCHIVE_SHA%% *}" = "${RESTORED_SHA%% *}" ] \
  && echo "media readback SHA-256 matches" \
  || { echo "ERROR: restored media bytes differ from archive." >&2; exit 1; }
```

---

## 步驟 6：停止下的 orphan reconciliation（crash-gap 清理）

> **目的與前提**：SQLite `post_images` 的 `ON DELETE CASCADE` **只刪 metadata
> row、永不刪除** `/data/media` 下的 filesystem bytes。Crash-gap（temp→atomic move
> 成功、DB commit 前 crash）或 compensating delete 失敗會留下私有 orphan file
> （無 DB row、public 不可見）。本程序把 unreferenced bytes 移入 timestamped
> quarantine——**只 move、不 delete**。**絕不**在應用寫入時執行：正在寫入或正要
> commit 的檔案會被誤判為 orphan。

### 6a. 停止應用、確認無寫入

```bash
docker compose stop --timeout 30 app
docker compose ps --all
# deck-app 應顯示 Exited
```

### 6b. 匯出 referenced storage keys 並比對、移入 quarantine（fail-closed）

```bash
TS=$(date -u +%Y%m%dT%H%M%SZ)
QUARANTINE="${BACKUP_DIR}/orphan-quarantine-${TS}"

# 拒絕沿用已存在的 quarantine：可能殘留上次 quarantine 的檔案，避免後續 mv 覆寫。
# quarantine 固定是新的 timestamped 目錄，內容交由操作者事後明確清理。
if [ -e "${QUARANTINE}" ]; then
  echo "ERROR: ${QUARANTINE} already exists; pick a new TS, do not reuse." >&2
  exit 1
fi
sudo install -d -o deploy -g deploy -m 700 "${QUARANTINE}"

# Fail-closed 前置：SQLite export 失敗、schema/integrity 不可用或任何 referenced key
# 違反 strict grammar 時，一律在列舉/移動任何檔案之前中止——絕不讓失敗的 pipeline
# 變成空的 reference list。count 用 `if ! ... =$(...)` 形式取得：在無 `set -e` 的
# shell 中 `VAR=$(...)` 失敗不會自動中止，必須以 `if !` 明確攔截，再驗證是
# non-negative decimal。
if ! POST_IMAGES_COUNT=$(sudo sqlite3 "${DATA_DIR}/deck.db" \
  "SELECT COUNT(*) FROM post_images;"); then
  echo "ERROR: cannot read post_images schema/count; abort." >&2
  exit 1
fi
case "${POST_IMAGES_COUNT}" in
  ''|*[!0-9]*)
    echo "ERROR: post_images count '${POST_IMAGES_COUNT}' is not a non-negative decimal; abort." >&2
    exit 1
    ;;
esac

if ! INTEGRITY=$(sudo sqlite3 "${DATA_DIR}/deck.db" "PRAGMA integrity_check;") \
   || [ "${INTEGRITY}" != "ok" ]; then
  echo "ERROR: integrity_check unavailable or not ok; abort reconciliation." >&2
  exit 1
fi

# 匯出 full referenced set；匯出失敗立即中止。
REF_FILE="${QUARANTINE}/referenced-keys.txt"
RAW_FILE="${QUARANTINE}/referenced-keys.raw"
if ! sudo sqlite3 "${DATA_DIR}/deck.db" \
  "SELECT storage_key FROM post_images;" > "${RAW_FILE}"; then
  echo "ERROR: SQLite export failed; abort." >&2
  exit 1
fi

LC_ALL=C grep -E '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png)$' \
  "${RAW_FILE}" | LC_ALL=C sort -u > "${REF_FILE}"

STRICT_ROWS=$(wc -l < "${REF_FILE}")
if [ "${POST_IMAGES_COUNT}" -ne "${STRICT_ROWS}" ]; then
  echo "ERROR: ${POST_IMAGES_COUNT} post_images rows but only ${STRICT_ROWS} pass strict grammar; abort." >&2
  exit 1
fi
rm -f "${RAW_FILE}"

# media 頂層必須是 real directory；symlink 或非 directory 一律拒絕。
if [ -e "${DATA_DIR}/media" ] \
  && { [ -L "${DATA_DIR}/media" ] || [ ! -d "${DATA_DIR}/media" ]; }; then
  echo "ERROR: ${DATA_DIR}/media is a symlink or not a real directory; abort." >&2
  exit 1
fi

# 只處理 media 頂層、符合 strict grammar 的 regular file；未被參照者移入 quarantine。
# `find -type f` 不追蹤 symlink；移動前再確認目標不存在（mv 不得覆寫任何既有檔案），
# 任一 move 失敗立即中止。
if [ -d "${DATA_DIR}/media" ]; then
  while IFS= read -r -d '' FILE; do
    NAME=${FILE##*/}
    if [[ "${NAME}" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png)$ ]] \
      && ! grep -Fqx "${NAME}" "${REF_FILE}"; then
      if [ -e "${QUARANTINE}/${NAME}" ]; then
        echo "ERROR: ${QUARANTINE}/${NAME} already exists; abort." >&2
        exit 1
      fi
      sudo mv "${FILE}" "${QUARANTINE}/${NAME}" \
        || { echo "ERROR: move failed for ${FILE}; abort." >&2; exit 1; }
      printf 'quarantined %s\n' "${NAME}"
    fi
  done < <(sudo find "${DATA_DIR}/media" -maxdepth 1 -type f -print0)
fi
```

比對規則：只處理 `/data/media` 頂層、符合 strict storage-key grammar
（UUID-v4 + `jpg|png`）的 regular file；凡是未出現在 `referenced-keys.txt` 的
strict-keyed file 就移入 quarantine。**非 strict grammar 檔案、目錄、symlink 一律
不碰**，避免誤移 config/temp 或破壞結構。quarantine 內保留 `referenced-keys.txt`
供稽核。

### 6c. 重新啟動並健康檢查

```bash
docker compose up -d --no-deps --wait --wait-timeout 90 app
docker compose ps                 # deck-app 應顯示 Up (healthy)
docker exec deck-app \
  curl -fsS http://127.0.0.1:8080/actuator/health    # 預期: {"status":"UP"}
```

應用健康、`GET /api/media/{id}` 回讀正常、確認 quarantine 內容確實無 DB 參照之後，
才由操作者手動、明確地清除 quarantine；本 runbook 永不自動刪除。

---

## 附錄 A：映像回滾 vs Schema 回滾

| 情境 | 動作 | 說明 |
|------|------|------|
| 應用程式 bug，schema 未變 | 只回滾 `APP_IMAGE` | 資料庫不須變動，直接切換 image |
| Migration SQL 失敗/不相容（V9） | 還原 DB 備份 + media snapshot + 回滾 image | 三者皆須執行；image 回滾不復原 schema/filesystem |
| 部署後發現 migration 有邏輯錯誤 | 還原 DB 備份 + media snapshot + 回滾 image | 修正後用新版本部署，不走修補 |
| 已成功 migrate 但須退回舊 schema | 還原 DB 備份 + 回滾 image | 不手動 DELETE history rows |
| V9 部署失敗（metadata 與 bytes 分裂） | 還原**同一 manifest** 的 DB + media + 回滾 image | 絕不做「只還原 DB」的 V9 rollback |

摘要：**回滾 image 不等於回滾 schema**。Image 回滾只換容器執行檔；
schema 回滾必須從 `.backup` 還原資料庫檔案。**V9 之後 media 與 DB 是同一
release snapshot**：rollback 一定成對還原同一個 manifest 記載的 DB backup 與
media archive（`MEDIA_PRESENT=no` 的 V8 來源則只還原 DB）。

---

## 附錄 B：部署後報告範本

```text
=== Migration Deploy Report ===
Date:         2026-09-03T12:00:00Z
Old image:    ghcr.io/fallrising/phark:sha-abc123...
New image:    ghcr.io/fallrising/phark:sha-def456...
Backup:       /opt/apps/deck/backups/deck-20260903T120000Z.db
Media:        /opt/apps/deck/backups/deck-20260903T120000Z-media.tar.gz
              (MEDIA_PRESENT=yes, N files) / none (V8 source)
Integrity:    ok
Container:    Up (healthy)
Migration:    V1 ~ V9 success = 1
Result:       SUCCESS / FAILED → restored to abc123...
```

把完成後的報告保存為
`/opt/apps/deck/backups/deploy-report-${TS}.txt`，並連同對應的
`deck-${TS}.restore.env`、database snapshot 與部署記錄一起保留。
