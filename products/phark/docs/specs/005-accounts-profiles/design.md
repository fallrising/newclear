# 005：帳號與個人資料設計

## 邊界與資料流

```text
Browser SPA
  ├─ GET /api/auth/csrf ────────────────┐
  ├─ POST /api/accounts + CSRF          │
  ├─ POST /api/auth/login + CSRF        │
  └─ session cookie + CSRF header       │
                                         ▼
RequestIdFilter ──> Spring Security filter chain
                     ├─ CSRF validation
                     ├─ session SecurityContext
                     ├─ 401/403 Problem Details
                     └─ public/protected route rules
                                         │
                                         ▼
Controller ──> Service ──> JdbcClient repositories ──> SQLite
                   │
                   ├─ account/profile
                   └─ authenticated account ID becomes content owner
```

`RequestIdFilter` 保持最高 servlet filter 順序，讓 Spring Security 在 controller
之前拒絕 request 時仍具有 request ID。Security entry point/access-denied handler
與 MVC `ApiExceptionHandler` 共用同一個 Problem Details writer，避免 401/403
退回 HTML、redirect 或不同 schema。

## Schema V4

```sql
CREATE TABLE accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    handle TEXT NOT NULL COLLATE NOCASE UNIQUE,
    display_name TEXT NOT NULL,
    bio TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE posts
    ADD COLUMN author_account_id INTEGER
    REFERENCES accounts(id) ON DELETE SET NULL;

ALTER TABLE replies
    ADD COLUMN author_account_id INTEGER
    REFERENCES accounts(id) ON DELETE SET NULL;

CREATE INDEX idx_posts_author_timeline
    ON posts(author_account_id, created_at DESC, id DESC);
CREATE INDEX idx_replies_author
    ON replies(author_account_id);
```

Migration 不回填 account、不修改 `author`。Tests 必須從 V3 schema 與 pre-Flyway
legacy schema 升級，驗證 row/sequence/index/history。SQLite migration 在 application
startup 前完成，舊 application image 不理解新增 nullable columns，但 rollback schema
仍依既有 backup/restore runbook，不假設 reverse compatibility。

## Backend components

### Account model

- `Account`：repository/private domain，包含 ID 與 password hash。
- `AccountProfile`：public response，只含 handle、display name、bio、createdAt。
- `AccountPrincipal`：Spring Security principal，至少包含 immutable account ID、
  canonical handle 與 encoded password；不序列化。
- `AccountSummary` 不另建巢狀 response；本輪維持 `author` 字串並新增
  `authorHandle`，降低成功 response breaking surface。

### Account persistence/service

`AccountRepository` 使用 parameterized `JdbcClient`：

- `insert(handle, displayName, passwordHash)`
- `findByHandle(handle)` / `findById(id)`
- `updateProfile(id, displayName, bio)`
- 唯一 constraint collision 由 service 映射成 `HANDLE_UNAVAILABLE`

`AccountService` 負責 trim/canonicalization、UTF-8 password byte boundary、hash、
public profile mapping 與 current-account lookup。Handle canonicalization 只有一個
helper，registration、login、profile route 共用。

### Spring Security

新增 `spring-boot-starter-security` 與 test-scope `spring-security-test`。明確提供：

- `SecurityFilterChain`
- `PasswordEncoder`（delegating format，initial `{bcrypt}`）
- JDBC-backed `UserDetailsService`
- `DaoAuthenticationProvider` / `AuthenticationManager`
- `HttpSessionSecurityContextRepository`
- session authentication strategy
- Problem Details `AuthenticationEntryPoint` 與 `AccessDeniedHandler`

Route policy：

- Public GET：timeline、replies、profiles、session、CSRF、static、health/info。
- Public unsafe：registration、login，但仍受 CSRF。
- Authenticated unsafe：logout、profile update、post/reply create。
- 其他既有 read routes 保持 public。

不啟用 form login page、HTTP Basic、remember-me 或 request cache redirect。

### JSON login

`AuthController` 使用 `AuthenticationManager` 驗證 JSON credentials，再：

1. 建立 empty `SecurityContext`。
2. 執行 session authentication strategy，更新既有 anonymous session ID。
3. 設定 authenticated principal。
4. 透過 `HttpSessionSecurityContextRepository` 保存。
5. 回傳 `SessionResponse`。

錯誤 credentials 統一轉為 `INVALID_CREDENTIALS`。Logout 交由 Spring Security
logout support 清除 context/session/cookie，success handler 回傳 204。

### CSRF lifecycle

使用 `HttpSessionCsrfTokenRepository`，不建立 JavaScript-readable token cookie：

1. SPA boot 呼叫 `/api/auth/csrf`，response body 暴露 header name/token。
2. API client 在 unsafe method 加入 token header。
3. Login/logout 後 token 失效，client 立即重新 fetch。
4. 403 `CSRF_TOKEN_INVALID` 促使 UI 顯示安全 fallback；不自動重試 mutation。

Token endpoint `Cache-Control: no-store`，token 不進 localStorage、URL 或 log。

## Authorship 與 query

Create DTO 移除 `author`：

```text
Controller receives AccountPrincipal
  └─ service passes accountId
       └─ repository INSERT author_account_id + current display-name snapshot
```

Read query：

```sql
SELECT ...,
       COALESCE(a.display_name, p.author) AS resolved_author,
       a.handle AS author_handle
FROM posts p
LEFT JOIN accounts a ON a.id = p.author_account_id
```

Replies 使用相同策略。`Post`/`Reply` records 增加 nullable `authorHandle`，原本
`author` JSON member 保持字串。Profile posts page 以 account ID predicate 加上既有
`created_at,id` keyset cursor；index 以相同排序支援。

Seed posts 保持 legacy ownership null，避免建立具已知 password 的 production
帳號。

## Frontend components

### API boundary

- `api/client.ts`：Problem Details parser、CSRF memory state、same-origin fetch wrapper。
- `api/accounts.ts`：csrf/session/register/login/logout/profile calls。
- `api/posts.ts`：改用共用 wrapper；create request 不再含 author。

Unsafe wrapper 在沒有 CSRF token 時 fail closed，不送出 mutation。App boot 先並行
載入 CSRF 與 session，再載入 public timeline；login/logout 後 refresh token。

### UI state

`App` 管理 `sessionAccount` 與簡單 location state：

- `/`：三欄 timeline。
- `/profiles/{handle}`：公開 profile 與 cursor-paginated author posts。

不新增 router dependency；使用 browser history、`popstate` 與標準 anchor fallback。
Header 提供 register/login/logout。Composer 與 reply composer 在 anonymous 時顯示
登入提示；authenticated 時移除 author input並顯示目前 identity。

Profile owner 可編輯 display name/bio。Profile 更新後 refresh session/profile 與
feeds，使 joined author display name 一致。

## TDD 與 checkpoint

| Checkpoint | RED | GREEN / refactor |
|------------|-----|------------------|
| Migration/account | V4 upgrade + repository tests | schema、repository、hash-safe service |
| Authentication | CSRF/session/login/logout contract tests | SecurityConfig、auth endpoints、Problem writer |
| Ownership/profile API | anonymous/spoof/profile pagination tests | authenticated create、profile query/update |
| Frontend | TypeScript contract break | API wrapper、auth UI、profile UI |
| Delivery | runtime auth/CSRF smoke | docs、Docker、CI evidence |

每列完成後獨立 commit/push；實作過程先跑 focused test，再跑完整 backend 或
frontend gate。

## 安全與營運

- Password、hash、session ID、CSRF token 不寫 log。
- Login error 固定，不提供 user enumeration signal。
- Session cookie HttpOnly、SameSite=Lax；`SESSION_COOKIE_SECURE=true` 是 HTTPS
  production 必要設定，本機 HTTP smoke 使用 false。
- Session timeout 預設 30 分鐘；restart 會清除登入狀態。
- 只有 backend 決定 content owner；body 中未知 `author` member 不影響 ownership。
- Handle 不是 authorization secret；account ID 只在 server-side principal/FK 使用。
- Rate limiting、password reset 與 account recovery 是明確 follow-up，不以未驗證
  stub 假裝完成。

## 驗證

- Focused migration/account/security/controller tests
- Full Maven suite
- Frontend lint + TypeScript/Vite build
- Multi-stage Docker build
- Runtime：register、bad login、login session-ID rotation、authenticated post/reply、
  profile update/read、logout、anonymous write rejection、CSRF rejection
- GitHub Actions final head
