# 004：一致的 API 錯誤契約

> 狀態：Completed
> 日期：2026-07-30

## 問題

Phark 的 API 目前只有狀態碼相對穩定，錯誤 body 則由不同來源各自產生：

- service 使用 `ResponseStatusException` 回報無效 channel、limit、cursor 與不存在的文章。
- Jakarta Bean Validation 回報建立文章、回覆時的欄位錯誤。
- Spring MVC 回報型別錯誤、malformed JSON、錯誤 method 與 media type。
- 未預期的 repository/runtime exception 回傳 framework 預設 500。

Controller tests 只驗證 status，前端在 `response.ok === false` 時丟棄 response body，
因此 client 無法依穩定代碼處理錯誤，使用者也看不到後端提供的可行動訊息。請求在
log 與 HTTP response 之間也沒有共同識別碼，增加 production 除錯成本。

## 目標

- 所有 `/api/**` 非 2xx response 使用 RFC 9457 Problem Details。
- 用機器可讀、穩定的 `code` 表達錯誤類型，不要求 client 解析 `detail`。
- validation failure 回傳可定位到欄位的 `violations`。
- 每個 API request 都具有 request correlation ID，並在 response header、problem
  body 與 server logging context 中一致。
- 500 response 不洩漏 exception message、stack trace、SQL 或檔案路徑。
- 前端保留 HTTP status、問題代碼、request ID 與安全的使用者訊息。

## 非目標

- 不加入 distributed tracing、OpenTelemetry 或外部 log aggregation。
- 不建立錯誤碼的多語系系統。
- 不在本輪加入每個表單欄位的 inline error UI；前端先顯示 server detail。
- 不改變成功 response schema、pagination contract 或資料庫 schema。
- 不讓 client 依 `title`、`detail` 或 validation message 做流程分支。

## 錯誤契約

Error response 使用 `Content-Type: application/problem+json`，包含 RFC 9457 標準
members 與 Phark extensions：

```json
{
  "type": "urn:phark:problem:validation-failed",
  "title": "Validation failed",
  "status": 400,
  "detail": "One or more request fields are invalid.",
  "instance": "/api/posts",
  "code": "VALIDATION_FAILED",
  "requestId": "req-example-123",
  "violations": [
    {
      "field": "content",
      "message": "content must not be blank"
    }
  ]
}
```

- `type` 是絕對、穩定、不可由 client 拼接的 URN。
- `code` 是 client 的主要分支依據；已發布值不得改變語意。
- `detail` 只提供人類可讀、可安全顯示的本次錯誤說明。
- `instance` 是不含 query string 的 request path。
- `requestId` 與 `X-Request-ID` response header 相同。
- `violations` 只在有欄位級錯誤時存在，依 `field`、`message` 排序，避免不穩定輸出。
- Client 必須忽略不認識的 extension members。

## 錯誤代碼

| Code | HTTP | 使用時機 |
|------|------|----------|
| `VALIDATION_FAILED` | 400 | JSON body 通過解析，但欄位 constraint 失敗 |
| `INVALID_CHANNEL` | 400 | query/body channel 不在 `home`、`tech`、`ops` |
| `INVALID_LIMIT` | 400 | limit 不是整數或不在 1–100 |
| `INVALID_CURSOR` | 400 | timeline/replies cursor 無法解碼或不合法 |
| `INVALID_POST_ID` | 400 | post path ID 不是正整數或無法轉成 long |
| `MALFORMED_REQUEST` | 400 | JSON 缺失、語法錯誤或無法讀取 |
| `POST_NOT_FOUND` | 404 | 目標文章不存在 |
| `RESOURCE_NOT_FOUND` | 404 | `/api/**` route/resource 不存在 |
| `METHOD_NOT_ALLOWED` | 405 | route 存在但 HTTP method 不支援 |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | request content type 不支援 |
| `INTERNAL_ERROR` | 500 | 未預期的 server failure |

新增 code 必須同時定義唯一 `type`、固定 status、title、default detail 與 contract
test。若同一語意只需更清楚的文字，更新 `detail` 而不是新增 code。

## Correlation ID 契約

- Header 名稱為 `X-Request-ID`。
- Client 可提供符合 `[A-Za-z0-9._-]{1,64}` 的值；server 會原樣沿用。
- Header 缺失、過長或含其他字元時，server 產生 UUID，而不是拒絕業務 request。
- Server 在呼叫下游程式前把 ID 放入 request attribute 與 SLF4J MDC
  `requestId`，並在 `finally` 清除 MDC，避免 thread reuse 汙染下一個 request。
- 成功與失敗 response 都回傳 header；Problem Details 另外包含同值 extension。

## 使用者故事

1. 作為 frontend developer，我能以 `code` 處理 API 錯誤而不解析英文句子。
2. 作為使用者，我提交無效內容時會看到後端回傳的安全、可行動訊息。
3. 作為維運者，我能用 UI 顯示的 request ID 對應 server log。
4. 作為安全維護者，我能確定未知 500 不向 client 暴露內部 exception details。

## 驗收情境

### Scenario：欄位驗證失敗

Given client 以固定 `X-Request-ID` 建立空白內容的文章  
When API 驗證 request body  
Then response 為 400 `application/problem+json`  
And `code` 是 `VALIDATION_FAILED`  
And `violations` 包含 `content`  
And header 與 body 的 request ID 相同。

### Scenario：領域輸入錯誤

Given client 查詢不存在的 channel、越界 limit 或無效 cursor  
When service 拒絕輸入  
Then response 使用對應的穩定 code  
And 不依 exception message 推導 code。

### Scenario：文章不存在

Given client 查詢不存在文章的 replies  
When API 驗證 parent post  
Then response 為 404  
And `code` 是 `POST_NOT_FOUND`。

### Scenario：未預期錯誤

Given server 發生未被分類的 exception  
When API 建立 500 response  
Then `code` 是 `INTERNAL_ERROR`  
And body 不包含 exception message、class、stack trace、SQL 或本機 path  
And server log 保留 exception 與 request ID。

### Scenario：前端顯示 API 問題

Given backend 回傳合法 Problem Details  
When frontend API client 收到 non-2xx response  
Then 它拋出含 status、code、detail、request ID 的 typed error  
And UI 顯示安全 detail  
And body 無法解析時仍使用既有 generic fallback。

## 約束與風險

- 使用 Spring Framework 既有 `ProblemDetail`、`ResponseEntityExceptionHandler` 與
  servlet filter，不新增 production dependency。
- Error advice 必須涵蓋 application exceptions 與主要 Spring MVC failures。
- Request ID 是關聯資料，不是 authentication、authorization 或信任邊界。
- Validation message 是顯示文字；client 只能以 top-level `code` 與 violation
  `field` 判斷。
- 完整 request URI 可能包含敏感 query，因此 `instance` 只保留 path。

## 驗收條件

- [x] 文件中的所有 error codes 都有 backend contract tests。
- [x] validation response 含 deterministic `violations`。
- [x] domain services 不再用 `ResponseStatusException` 表達已知業務錯誤。
- [x] malformed JSON、type mismatch、404、405、415 與未知 500 使用同一 body shape。
- [x] 合法 inbound request ID 被沿用；不合法值被安全替換。
- [x] 成功與錯誤 response 都有 `X-Request-ID`。
- [x] frontend 能解析 Problem Details 且保留 generic fallback。
- [x] backend tests、frontend lint/build、Docker/runtime smoke 與 GitHub Actions 通過。

## 參考

- [RFC 9457 — Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457.html)
- [Spring MVC error responses](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-ann-rest-exceptions.html)
- [Spring Boot servlet error handling](https://docs.spring.io/spring-boot/3.5/reference/web/servlet.html)
