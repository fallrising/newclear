# SDD-004 驗證紀錄

> 驗證日期：2026-07-30
> Branch：`agent/consistent-api-errors`

## 自動化測試

| Gate | 結果 | 證據 |
|------|------|------|
| Backend tests | 通過 | Maven Surefire 共執行 76 tests，0 failures、0 errors、0 skipped |
| Frontend lint | 通過 | `npm run lint` exit 0；保留既有 `button.tsx:45` 的單一 `react(only-export-components)` warning |
| Frontend production build | 通過 | TypeScript 與 Vite production build 完成 |
| Multi-stage Docker build | 通過 | `phark:sdd004` → `sha256:681e56b50fe69026ca58f1dd089f41af40f8a8b394736cf91c8c99cecb2edead` |

Docker build 會在各 stage 重新執行 frontend lint/build 與 backend tests，因此上述
三個 gate 也已在 production image build context 中重現。

## Production-like runtime smoke

以映像 `phark:sdd004` 啟動一次性容器，將 container port 8080 映射至 host
port 18084。驗證完成後已停止並由 `--rm` 清理。

### Health

```text
GET /actuator/health
200
{"status":"UP"}
```

### 成功 response correlation

```text
GET /api/posts?channel=home&limit=1
X-Request-ID: smoke-success-123

HTTP/1.1 200
X-Request-ID: smoke-success-123
Content-Type: application/json
```

Response body 保持既有 timeline envelope，證明 correlation filter 未改變成功契約。

### 400 Problem Details

```text
GET /api/posts?channel=news
X-Request-ID: smoke-error-400

HTTP/1.1 400
X-Request-ID: smoke-error-400
Content-Type: application/problem+json

{"type":"urn:phark:problem:invalid-channel","title":"Invalid channel",
 "status":400,"detail":"Channel must be one of: home, tech, ops.",
 "instance":"/api/posts","code":"INVALID_CHANNEL",
 "requestId":"smoke-error-400"}
```

### 404 Problem Details

```text
GET /api/not-found
X-Request-ID: smoke-error-404

HTTP/1.1 404
X-Request-ID: smoke-error-404
Content-Type: application/problem+json

{"type":"urn:phark:problem:resource-not-found","title":"Resource not found",
 "status":404,"detail":"The requested resource was not found.",
 "instance":"/api/not-found","code":"RESOURCE_NOT_FOUND",
 "requestId":"smoke-error-404"}
```

## GitHub Actions

- Commit：`95ad46403ca3b25660ce815eb7b7a50b5acec66d`
- Workflow job：[Build container image](https://github.com/fallrising/phark/actions/runs/30554948797/job/90912897079)
- 結果：1 successful、0 failing、0 skipped

此 job 從乾淨的 GitHub runner 執行 production multi-stage Docker build，涵蓋
frontend lint/build 與完整 backend test suite。
