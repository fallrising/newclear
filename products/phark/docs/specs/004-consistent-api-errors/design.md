# 004：一致的 API 錯誤設計

## 邊界與資料流

```text
HTTP request
  │
  ▼
RequestIdFilter
  ├─ validate or generate X-Request-ID
  ├─ request attribute + MDC
  └─ response header
  │
  ▼
Controller ──> Service ──> Repository
  │               │              │
  │               └─ ApiException│
  │                              └─ unexpected Exception
  ▼
ApiExceptionHandler extends ResponseEntityExceptionHandler
  ├─ Bean Validation ─────────────> VALIDATION_FAILED + violations
  ├─ Spring MVC input failures ───> stable framework-facing code
  ├─ ApiException ────────────────> declared domain code
  └─ unexpected Exception ────────> logged INTERNAL_ERROR
  │
  ▼
application/problem+json + matching X-Request-ID
```

Correlation 在 exception mapping 之前建立，讓成功 response、可預期 4xx 與未知 500
都能共享同一 ID。Filter 使用 `finally` 清理 MDC；response header 在 filter chain
前設定，確保 error dispatch 仍可取得。

## Backend components

### `ApiErrorCode`

Enum 集中管理 immutable contract：

- stable `code`（enum name）
- absolute problem `type`
- HTTP status
- title
- default safe detail

Contract 不從 exception message 或 HTTP reason phrase 反向推導。已知錯誤由 service
直接拋出帶 `ApiErrorCode` 的 `ApiException`。

### `ApiException`

只攜帶 error code、由 code 定義的安全 detail 與 optional cause。原始 cause 可供
server log 使用，但不序列化；validation violations 則由 MVC handler 從 binding
result 建立。這會取代 `PostService`、`ReplyService` 中現有的
`ResponseStatusException`。

### `ApiExceptionHandler`

Handler 以 Spring `ProblemDetail` 建立 response，並由同一 helper 寫入：

- `type`、`title`、`status`、`detail`、`instance`
- `code`、`requestId`
- optional `violations`
- `Content-Type: application/problem+json`

它覆寫 `ResponseEntityExceptionHandler` 的 narrow hooks：

| Spring failure | Mapping |
|----------------|---------|
| `MethodArgumentNotValidException` | `VALIDATION_FAILED` |
| `MethodArgumentTypeMismatchException` | 依參數名映射 `INVALID_LIMIT` / `INVALID_POST_ID`，其餘 `MALFORMED_REQUEST` |
| `HttpMessageNotReadableException` | `MALFORMED_REQUEST` |
| `HttpMediaTypeNotSupportedException` | `UNSUPPORTED_MEDIA_TYPE` |
| `HttpRequestMethodNotSupportedException` | `METHOD_NOT_ALLOWED` |
| `NoResourceFoundException` | `RESOURCE_NOT_FOUND` |

自訂 `@ExceptionHandler` 處理 `ApiException` 與最後一道 `Exception`。未知 exception
以 request ID 記錄完整 stack trace，但對外只使用 `INTERNAL_ERROR` 的固定 detail。

Validation violations 只輸出 field 與現有 constraint message，排序後設為 immutable
list。Object-level constraint 未提供 field 時使用空字串，避免加入未定義 schema。

## Request ID

`RequestIdFilter` 是 `OncePerRequestFilter`：

1. 讀取第一個 `X-Request-ID` header。
2. 完整符合 allowlist 且長度不超過 64 時沿用。
3. 其他情況以 `UUID.randomUUID().toString()` 取代。
4. 寫入 request attribute、MDC 與 response header。
5. 執行 filter chain，最後清除 MDC。

共用常數放在 filter 或小型 utility，不建立通用 tracing abstraction。Problem handler
優先讀 request attribute；若測試或非標準 dispatch 缺少 attribute，產生新 UUID 並
同步 response header，維持契約而不回傳 null。

## Frontend components

`frontend/src/api/posts.ts` 增加：

- `ApiProblem`：Problem Details 的最小 client view。
- `ApiError extends Error`：保存 `status`、`code`、`requestId`、`violations`。
- `throwApiError(response, fallback)`：只有 body 符合基本 shape 時採用 server
  `detail`；malformed/HTML/empty body 使用既有 fallback。
- `getApiErrorMessage(error, fallback)`：UI 只顯示合法 API detail，network error
  與 unknown 500 使用 generic fallback。

不讓 UI components 各自解析 `Response`，所有 fetch functions 共用同一 helper。
本輪保留既有 alert 位置與 client-side required checks。

## 相容性

- HTTP status 維持現有語意。
- 成功 response 完全不變，只多一個 response header。
- Error body 是刻意的 breaking contract；目前 frontend 未解析舊 body，沒有內部
  client migration 負擔。
- 未知 extension 可向後相容增加；現有 code 的 status/語意不可更改。

## 測試策略

### Backend contract tests

先新增失敗的 MockMvc tests，固定 inbound request ID 並驗證：

- content type 與所有 common members
- domain codes：channel、limit、cursor、post ID、post not found
- validation violations
- malformed JSON、type mismatch、method、media type、missing route
- success request ID echo
- invalid inbound request ID replacement
- 500 body redaction 與 correlation

對未知 500 使用 test-only controller 或 mock service 製造 deterministic failure，
不破壞 repository。

### Frontend tests

若現有 toolchain 沒有 test runner，本輪不新增 dependency。以 TypeScript build 驗證
typed client，並由 API helper 的純函式結構降低 component duplication；runtime
smoke 驗證 UI/API wiring。若可使用既有 runner，新增 parse/fallback unit tests。

### 整合驗證

- `mvn test`
- `npm run lint`
- `npm run build`
- multi-stage Docker build
- production container success/error curl smoke
- GitHub Actions checks

## 安全考量

- 不序列化 exception、cause、stack trace 或 framework binding object。
- Unknown 500 的 detail 固定，不採用 `exception.getMessage()`。
- Request ID allowlist 防止換行/log injection 與不受限 header。
- `instance` 排除 query string。
- Problem `detail` 可供人閱讀但不是安全診斷通道；敏感診斷只留 server logs。
