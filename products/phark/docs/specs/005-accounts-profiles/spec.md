# 005：帳號與個人資料

> 狀態：Complete
> 日期：2026-07-30

## 問題

Phark 目前讓 client 在每次建立文章或回覆時自由提交 `author` 字串。這表示任何人
都能冒用任何顯示名稱，資料庫也無法知道兩筆內容是否屬於同一位作者。Likes、
reposts、notifications 等後續功能因此沒有可靠的使用者與 ownership 基礎。

應用程式同時缺少登入狀態與公開個人資料頁。加入帳號時不能把既有自由文字作者
直接轉成可登入帳號，否則新註冊者可能「認領」歷史內容；也不能為了 SPA 方便而
停用 session authentication 所需的 CSRF 保護。

## 目標

- 使用者可註冊唯一 handle，以密碼登入同源 SPA，並安全登出。
- 密碼只保存 adaptive one-way hash，錯誤登入不洩漏帳號是否存在。
- 每個 unsafe request 都受 CSRF token 保護；登入會更新 session ID。
- 使用者可查看與修改自己的 display name、bio，並查看公開 profile page。
- 新文章與回覆的作者只從已驗證 session 取得，client 不能指定或冒用作者。
- 公開 timeline 保留既有 `author` 字串，並新增 nullable `authorHandle` 供 profile
  link 使用。
- 既有文章、回覆與 seed data 保持可讀，且不會被任何新帳號自動認領。

## 非目標

- 不加入 email、email verification、password reset、MFA 或 OAuth/OIDC。
- 不支援修改 handle、變更密碼、刪除帳號或 persistent remember-me。
- 不加入 avatar/media upload。
- 不加入 post/reply edit/delete；本輪 ownership 是建立者身份與資料關聯。
- 不加入 login rate limiting；由 SDD-011 abuse controls 處理。
- 不加入 distributed/persistent HTTP session；目前仍是單一 instance monolith。

## Account 與 profile 規則

| 欄位 | 規則 |
|------|------|
| `handle` | canonical lowercase；3–15 個 ASCII `a-z`、`0-9`、`_`；建立後不可改 |
| `displayName` | trim 後 1–50 characters |
| `bio` | trim 後 0–160 characters |
| `password` | 12–72 UTF-8 bytes；不寫入 log、response 或 validation message |

Handle 使用 case-insensitive unique constraint；`Alice` 與 `alice` 是同一個
registration namespace。公開 response 永不包含 `passwordHash`。

## HTTP 契約

所有 endpoint 使用既有 RFC 9457 error contract 與 `X-Request-ID`。

| Method | Path | Auth | 說明 |
|--------|------|------|------|
| `GET` | `/api/auth/csrf` | Public | 取得 CSRF header name/token；`Cache-Control: no-store` |
| `POST` | `/api/accounts` | Public + CSRF | 註冊帳號；成功 `201`，不自動登入 |
| `POST` | `/api/auth/login` | Public + CSRF | JSON credentials；成功建立 authenticated session |
| `POST` | `/api/auth/logout` | Session + CSRF | 清除 security context、session 與 cookie；成功 `204` |
| `GET` | `/api/auth/session` | Public | 回傳目前 account，anonymous 時 `account: null` |
| `GET` | `/api/profiles/{handle}` | Public | 公開 profile |
| `PATCH` | `/api/profiles/me` | Session + CSRF | 修改目前 account 的 display name 與 bio |
| `GET` | `/api/profiles/{handle}/posts` | Public | 該 account 建立的 cursor-paginated posts |

### Registration request

```json
{
  "handle": "alice_ops",
  "displayName": "Alice",
  "password": "correct horse battery staple"
}
```

成功 response：

```json
{
  "handle": "alice_ops",
  "displayName": "Alice",
  "bio": "",
  "createdAt": "2026-07-30T12:00:00Z"
}
```

### Session response

`GET /api/auth/session` 永遠回傳 `200`：

```json
{
  "account": {
    "handle": "alice_ops",
    "displayName": "Alice",
    "bio": "",
    "createdAt": "2026-07-30T12:00:00Z"
  }
}
```

Anonymous response 是 `{"account":null}`。Login 成功回傳相同 shape。

### CSRF response

```json
{
  "headerName": "X-CSRF-TOKEN",
  "token": "<opaque-token>"
}
```

Frontend 啟動時取得 token，所有 `POST`/`PATCH`/`DELETE` request 放入指定 header；
登入及登出後重新取得 token，因為 security strategy 會輪替或清除舊 token。

### Content response compatibility

`Post` 與 `Reply` 保留：

```json
{
  "author": "Alice",
  "authorHandle": "alice_ops"
}
```

- Account-owned content 的 `author` 由目前 profile display name 解析。
- Legacy content 的 `author` 使用既有 snapshot，`authorHandle` 是 `null`。
- Create post/reply request 移除 `author`；server 只接受 session principal。

## Stable error codes

| Code | HTTP | 使用時機 |
|------|------|----------|
| `HANDLE_UNAVAILABLE` | 409 | canonical handle 已存在 |
| `INVALID_CREDENTIALS` | 401 | handle/password 組合無效，detail 不區分原因 |
| `AUTHENTICATION_REQUIRED` | 401 | protected endpoint 沒有有效 session |
| `CSRF_TOKEN_INVALID` | 403 | unsafe request 缺少或使用無效 CSRF token |
| `PROFILE_NOT_FOUND` | 404 | 公開 handle 不存在 |

Registration validation 繼續使用 `VALIDATION_FAILED`。Security filter 產生的 401/403
也必須使用 `application/problem+json`、stable code 與 matching request ID。

## 資料相容策略

新增 `accounts` table，以及 `posts.author_account_id`、
`replies.author_account_id` nullable foreign keys：

- V1–V3 immutable，不修改 checksum。
- 所有既有 row 的 ownership 維持 `NULL`；不依相同 author 文字建立帳號。
- 原有 `author TEXT NOT NULL` 保留為 legacy/snapshot fallback。
- 新內容同時寫 account ID 與 display-name snapshot。
- Read query 以 account profile 的目前 display name 為優先，無 account 時使用
  snapshot。
- 未來若帳號刪除，可由 `ON DELETE SET NULL` 回到 snapshot；本輪不提供刪除。

## 使用者故事

1. 作為新使用者，我能建立唯一 handle 並以密碼登入。
2. 作為登入使用者，我發文或回覆時不需輸入作者，內容必定歸屬於我的帳號。
3. 作為讀者，我能從新內容的 handle 前往公開 profile 與作者文章列表。
4. 作為 profile owner，我能修改 display name 與 bio，但不能修改其他帳號。
5. 作為既有部署維運者，我升級後仍能讀取所有 legacy posts/replies。

## 驗收情境

### Scenario：註冊與 case-insensitive uniqueness

Given 尚未存在 `alice`
When client 以有效 CSRF token 註冊 handle `Alice`
Then response 是 `201` 且 handle canonicalize 為 `alice`
And database 只保存 adaptive password hash。

Given `alice` 已存在
When client 註冊 `ALICE`
Then response 是 409 `HANDLE_UNAVAILABLE`
And response 不包含既有 account 的其他資料。

### Scenario：登入與 session fixation

Given client 已取得 anonymous session 與 CSRF token
When client 以正確 credentials 登入
Then response 包含 account
And authenticated session ID 不等於登入前的 ID
And 後續 `/api/auth/session` 回傳同一 account。

When credentials 不正確
Then response 是 401 `INVALID_CREDENTIALS`
And detail 不透露 handle 是否存在。

### Scenario：CSRF

Given client 有或沒有 authenticated session
When client 對 unsafe endpoint 不提供有效 token
Then response 是 403 `CSRF_TOKEN_INVALID` Problem Details
And request 不產生資料變更。

### Scenario：Authenticated authorship

Given `alice` 已登入
When client 建立 post/reply 並嘗試在 JSON 夾帶其他作者欄位
Then persisted ownership 仍是 `alice`
And response 的 `authorHandle` 是 `alice`。

Given client 未登入但提供有效 CSRF token
When client 建立 post/reply
Then response 是 401 `AUTHENTICATION_REQUIRED`
And database row count 不變。

### Scenario：Legacy content

Given V3 database 含自由文字作者的 posts/replies
When V4 migration 完成並讀取 timeline/thread
Then 所有 row、ID、content、timestamp 保留
And legacy `author` 不變
And legacy `authorHandle` 是 null。

### Scenario：Profile

Given `alice` 已建立內容
When 任何 client 開啟 `/profiles/alice`
Then UI 顯示 handle、display name、bio 與 alice 的 posts。

Given alice 已登入
When alice 修改自己的 display name 與 bio
Then profile 與 owned content 顯示新 display name
And 其他 account 無法透過 API 修改 alice。

## 約束與風險

- 使用 Spring Boot 3.5 對應的 Spring Security 6.5，不自製 bearer token protocol。
- Session cookie 為 HttpOnly、SameSite=Lax；HTTPS deployment 必須設定 Secure。
- Session 儲存在單一 application instance memory；restart 會登出使用者，符合目前
  replicas=1 架構，但必須在文件揭露。
- CSRF token 是 opaque secret，不寫入 log。
- BCrypt 的 72-byte input 邊界必須在 hash 前驗證，避免 silent truncation。
- Profile query 與 timeline join 必須保持 cursor ordering/index 使用方式。
- 新 backend 與 frontend 以同一 image 發布；create request 移除 `author` 是有意的
  API contract change。

## 驗收條件

- [x] V4 migration 對 empty、V3、legacy baseline database 都保留資料並通過。
- [x] Password hash、generic login failure、session fixation 與 logout 有 tests。
- [x] 所有 unsafe endpoints 實際需要 CSRF；401/403 遵循 Problem Details。
- [x] Anonymous read 保持可用；post/reply write 必須 authenticated。
- [x] Client 無法指定 ownership；legacy authors 不被新 account 認領。
- [x] Profile read/update 與 author posts cursor pagination 通過。
- [x] Frontend 完成 register/login/logout、authorship 與 profile flows。
- [x] Backend、frontend、Docker/runtime smoke 與 GitHub Actions 全綠。

## 參考

- [Spring Boot 3.5 — Spring Security](https://docs.spring.io/spring-boot/3.5/reference/web/spring-security.html)
- [Spring Security 6.5 — CSRF](https://docs.spring.io/spring-security/reference/6.5/servlet/exploits/csrf.html)
- [Spring Security 6.5 — Session management](https://docs.spring.io/spring-security/reference/6.5/servlet/authentication/session-management.html)
- [Spring Security 6.5 — Password storage](https://docs.spring.io/spring-security/reference/6.5/features/authentication/password-storage.html)
