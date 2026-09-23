# 06 — API 契約與模擬執行

## 1. 契約範圍

這是 dim-gate 前端預期的 BFF contract，**不是宣稱 AWS、Aliyun、Prism 或 CI 工具原生已有相同 API**。v0.1 由 MSW 實現；future backend 需自己完成 adapter 與 server-side authentication。M0–M4 將目前里程碑契約實體化為 Zod DTO 與 OpenAPI 文件，避免手寫頁面與 mock 各自漂移。

Base path `/api/v1` 相對於 application base；預設部署 `/dim-gate/` 時實際 URL 為 `/dim-gate/api/v1`，demo controls 同理為 `/dim-gate/__demo/v1`。JSON UTF-8；id opaque；時間 ISO-8601 UTC；bytes／CPU／memory 的單位按欄位名稱。未知 enum 是 schema error，不 fallback 到成功。禁止任意 filter DSL 或可執行 template。

Wire source 為 `src/domain/schemas.ts`、`src/api/control-dto.ts` 與 `src/api/contracts.ts`；[OpenAPI 3.1](../openapi.json) 由 Zod 產生，native check 比對完整結果與 `$ref`。M4 新增 scoped notifications operation，完成既有 observation／incident／integration paths；共 73 個 operations，執行與驗收狀態仍以 PLAN 及精確 commit 證據為準。JSON Schema 不能完整表達的跨 entity/provider/scope/state 規則仍須由 domain 驗證。Detail DTO 採具名包裝：`{application,environments}`、`{environment,placements,activeRelease}`、`{request,jobs}`、`{job,logs}`、`{run,logs}`、`{release,artifact,rollbackTargets}`；不可將 forward schema 的存在視為業務流程完成。後續里程碑擴充 typed pending items、完整 guide steps 等內容時須同步 schema、OpenAPI 與驗收。

CI wire projection 另有 `CIView`：只列出 caller 可見 project IDs；只有 pool grant 的 Ops 可以看到 CI 但得到空 visibilityProjectIds。保存的 CI 仍必須至少一個有效 project，不因回傳裁切放寬 domain invariant。

## 2. Envelope、context 與錯誤

```ts
type ApiResult<T> = {
  data: T;
  meta: { requestId: string; storeRevision: number; policyVersion: number };
};
type Page<T> = { items: T[]; total: number; page: number; pageSize: number };
type ApiError = {
  error: {
    code: string;
    message: string;
    fieldErrors?: Record<string, string[]>;
    retryable: boolean;
  };
  meta: { requestId: string };
};
type CommandReceipt = {
  entityType: string;
  entityId: string;
  entityVersion: number;
  correlationId: string;
  changed: { entityType: string; entityId: string }[];
  operationId?: string; // ProvisionJob or PipelineRun/Release id for async work
};
```

所有列表先 scope-filter 再分頁／total。共用 query：`q` ≤ 100 chars、`page` >=1、`pageSize` 1..100 預設25、`sort` 為 endpoint allowlist、`order=asc|desc`；排序最後以 id 作 tie-break。未知 filter 拒絕 422，不靜默忽略造成誤解。空集合是200；越界頁回空 items 及正確 total。

demo context 使用 `X-Demo-Persona` 與 `X-Demo-Session`，由同分頁 controller 提供，handler 驗 seed user 是否 enabled。future live backend 不接受這些 header 為 authentication，必須由 server session 解析身分；本版不設 token 輸入框。

| HTTP | Code 例子 | 前端處理 |
| --- | --- | --- |
| 401 | `UNAUTHENTICATED` | 顯示 persona/session 問題；不重試 |
| 403 | `FORBIDDEN`, `SELF_APPROVAL_DENIED` | 顯示不能執行的原因；不泄漏 scope 外 entity |
| 404 | `NOT_FOUND` | 不存在或超出資料 scope，統一處理 |
| 409 | `VERSION_CONFLICT`, `INVALID_STATE`, `ENVIRONMENT_BUSY`, `DUPLICATE_RESOURCE`, `CAPACITY_EXCEEDED`, `IDEMPOTENCY_CONFLICT` | 保留輸入、重新讀取後再確認；不自動重送 |
| 422 | `VALIDATION_ERROR`, `UNKNOWN_ENUM` | 對應 field errors |
| 429 | `DEMO_COMMAND_LIMIT` | 提供 reset；不靜默丟歷史 |
| 503 | `SIMULATED_UNAVAILABLE` | 說明故障情境，支援手動 retry |
| 507 | `DEMO_STORAGE_FULL` | mutation 未提交；提示釋放／重置或選記憶體 session |

Mutation 一律需要 `Idempotency-Key`，對 existing entity 的更新另需 body `expectedVersion`。idempotency key 的作用域是 `(sessionId, actorId, HTTP method, canonical path, key)`，存 request body hash 與已提交 response。相同 key/body 重放原 response；相同 key 不同 body 回409；不同 actor 不共享回覆。重放仍先驗當前 scope，不能用舊成功結果繞過撤權。

已提交 response replay 不再驗過期 expectedVersion；否則網路丟包後會無法取回首次成功結果。未提交的 validation／state failure 不建立成功 receipt cache。fresh command 用 fresh key；為同一次 unknown-result retry 必須沿用 key。records 保留整個 session，reset 才清。

## 3. Read endpoints

表中 prefix 均省略 `/api/v1`；未特別說明皆回 `ApiResult`。`{id}` 是 URI path parameter。

| GET endpoint | Params／filters | `data` |
| --- | --- | --- |
| `/session` | 無 | user、assignments、effective actions/scopes、demo flag、sessionId |
| `/organization` | 無 | scope-filtered businessUnits/teams/projects/users metadata |
| `/navigation` | `center` | 已按 permission／config 過濾的 routeKey/label/order |
| `/dashboard` | `center, projectId?, environmentId?` | typed counters、pending items、dataAsOf，全部按 scope |
| `/search` | `q, limit=10` 最大20 | `{items: EntitySearchHit[]}`，各項有 type/id/title/route |
| `/applications`、`/applications/{id}` | 列表 `projectId?, q` | `Page<Application>`／Application detail + 可見環境摘要 |
| `/environments/{id}` | 無 | Environment + placements + active release summary |
| `/cis`、`/cis/{id}` | 列表 `provider?, kind?, projectId?, environmentId?, health?, freshness?, q` | `Page<CI>`／經欄位授權的 CI detail |
| `/relations` | `ciId, direction=in\|out\|both` | `Page<Relation>`，兩端都可見 |
| `/topology` | `ciId` 或 `environmentId` 擇一、`mode=dependencies\|impact, depth=1..3` | nodes、edges、truncated、depthReached；100/200 caps |
| `/pools`、`/capacity` | `provider?, projectId?` | pool metadata／used,reserved,available quantities |
| `/catalog`、`/catalog/{id}` | `revision?` 僅 Admin 可查歷史 | `Page<CatalogItem>`／可見 revision |
| `/requests`、`/requests/{id}` | 列表 `state?, applicationId?, requesterId?` | `Page<Request>`／Request detail + job summaries |
| `/jobs`、`/jobs/{id}` | `requestId?, state?` | `Page<ProvisionJob>`／job + bounded step logs |
| `/pipelines`、`/pipelines/{id}` | `applicationId?, environmentId?, state?` | `Page<PipelineRun>`／run + stages + bounded logs |
| `/releases`、`/releases/{id}` | 列表 `environmentId?, state?, kind?` | `Page<Release>`／`{release,artifact,rollbackTargets}`；targets 僅含同環境、成功、異於 active artifact 且 registry 存在的版本 |
| `/observability/metrics` | `applicationId, environmentId, from, to, step=60s` | series `{metric,unit,points:[{t,value:null\|number}],sampleCount}` |
| `/observability/traces`、`/observability/traces/{id}` | 列表 app/env/from/to、`status?` | `Page<TraceSummary>`／Trace + spans(parentId,start,durationMs,status) |
| `/observability/logs` | app/env/from/to、`traceId?, releaseId?, level?` | `Page<LogEntry>`；单条 message ≤2KiB，每頁≤500 lines 的 UI cap，API pageSize 仍≤100 |
| `/incidents`、`/incidents/{id}` | `environmentId?, state?, severity?` | `Page<Incident>`／Incident + 可見 evidence refs |
| `/audit` | `entityType?, entityId?, correlationId?, actorId?, from?, to?` | `Page<AuditEvent>`，diffSummary 依 caller 裁切 |
| `/admin/access` | Admin only | organizations/users/assignments 與 policyVersion |
| `/admin/navigation` | Admin only、`center?` | 可配置 NavigationItem[] |
| `/admin/cmdb-models` | Admin only | CI kinds + ModelField[] |
| `/integrations` | Admin／Ops scope | 可見 Integration[] |
| `/notifications` | 無 | `{items: Notification[]}`，最近最多 20 個可見 domain events，無隱藏總數 |

時間窗口 from<to，最多24h；固定 demo clock 允許 UI 選近15m／1h／24h。沒有 sample 回空 points，不補0。百分比在資料層使用0..1 fraction，UI 顯示 percent；latency 使用ms、rate 使用requests/second。Trace／log references 必須與 caller 的 app/environment scope 相符，不能僅因知曉 traceId 就讀取。

## 4. Mutation endpoints

所有成功同步 command 回200 `CommandReceipt`，新建資源回201；啟動 async work 回202 receipt，後續以 operationId 讀取。receipt 的 entityVersion 是主要 entity 的新 version；所有 changed entities 以查詢取得最新版。

| Method / path | Body（省略共用 expectedVersion） | 核心結果 |
| --- | --- | --- |
| `POST /cis` | CI create fields，不接受 id/version/health/source/timestamps | source=manual、health=unknown、observedAt=null；201 |
| `PATCH /cis/{id}` | `name?, ownerTeamId?, tags?, visibilityProjectIds?, customFields?` | 固定 identity 不可改；200 |
| `POST /relations` | `sourceCiId,targetCiId,type,reason` | source=manual,confidence=verified；201 |
| `DELETE /relations/{id}` | `expectedVersion,reason` | 僅 manual edge；200 receipt 用刪除前version+1，audit保留 |
| `POST /requests` | `applicationId,environmentName,stage,catalogItemId,catalogRevision,provider,poolId,cpu,memoryMiB,purpose` | 201 draft；templateSnapshot 由 handler 取得 |
| `PATCH /requests/{id}` | `environmentName?,provider?,poolId?,cpu?,memoryMiB?,purpose?` | draft only；200 |
| `POST /requests/{id}/submit` | `expectedVersion` | 200 submitted |
| `POST /requests/{id}/approve` | `expectedVersion,reason` | 200 approved + queued job/reservation |
| `POST /requests/{id}/reject` | `expectedVersion,reason` | 200 rejected |
| `POST /requests/{id}/cancel` | `expectedVersion,reason` | 200 cancelled，按狀態釋放 reservation |
| `POST /requests/{id}/provision` | `expectedVersion` | 202，operationId=jobId |
| `POST /requests/{id}/retry` | `expectedVersion,reason` | 200 approved + 新 queued job；由 Ops 再啟動 |
| `POST /pipelines` | `applicationId,environmentId,revision,environmentVersion` | 202，operationId=runId；environmentVersion 作此 create 的 concurrency guard |
| `POST /pipelines/{id}/cancel` | `expectedVersion,reason` | 200 cancelled |
| `POST /pipelines/{id}/retry` | `expectedVersion,reason` | 202 new runId，不覆寫原 run |
| `POST /releases/{id}/approve` | `expectedVersion,reason` | 202 queued release；只有 pending_approval |
| `POST /releases/{id}/reject` | `expectedVersion,reason` | 200 rejected；如有所屬 run 則設 failed；释放環境鎖 |
| `POST /releases/{id}/rollback` | `expectedVersion,targetReleaseId,environmentVersion,reason` | path id 必須是當前 active；202 new rollback release，prod pending_approval |
| `POST /incidents/{id}/acknowledge` | `expectedVersion,reason?` | 200 acknowledged、assignee=current user |
| `POST /incidents/{id}/investigate` | `expectedVersion,reason` | 200 investigating；接手也記 reason |
| `POST /admin/assignments` | `userId,role,scopeType,scopeId,stages?,reason` | 201，policyVersion+1；已存在相同 assignment 回409 |
| `DELETE /admin/assignments/{id}` | `expectedVersion,reason` | 200、policyVersion+1；last Admin／self 防護 |
| `PATCH /admin/users/{id}` | `enabled,reason` | 200、policyVersion+1；不可停用自己／最後 Admin |
| `PATCH /admin/navigation/{id}` | `label?,group?,order?,enabled?` | 200；只允許已註冊 routeKey |
| `POST /admin/catalog/{id}/revisions` | `baseRevision,template,name,description,allowedProjectIds,reason` | 201 新 draft revision；current entity expectedVersion 必填 |
| `PATCH /admin/catalog/{id}` | `revision,template?,name?,description?,allowedProjectIds?` | 200 draft edit |
| `POST /admin/catalog/{id}/publish` | `revision,expectedVersion,reason` | 200 current revision 切換 |
| `POST /admin/catalog/{id}/disable` | `expectedVersion,reason` | 200 disabled；不刪 snapshot |
| `POST /admin/cmdb-fields` | `kind,key,label,valueType,constraints` | 201 optional field definition |
| `PATCH /admin/cmdb-fields/{id}` | `label?,hidden?` | 200，不改已使用 key/type |
| `POST /integrations/{id}/test` | `expectedVersion` | 200 demo test result，以安全摘要存入 metadata |

POST create 時 expectedVersion 不存在，除了表內明示 parent/current guard；其他 patch/delete/command 必須帶相應 target version。所有人輸入的 reason/purpose 長度1..500；name1..80；tag key1..64、value0..256、最多20；role/scope enums allowlist；request cpu1..64、memoryMiB128..262144 且128倍數，再受 template/pool 限制。

CI create body 具 orgId 以外的 [02 CI](02-cmdb-model.md) 可寫欄位；orgId 從 session 注入。pool/account/location/provider 一致且 caller 可寫；未知 body 欄位拒絕。visibilityProjectIds 至少一個有效 project，ownerTeamId 必須有效。所有其他 entity 的 orgId、actor、timestamps、derived state 由 handler 注入，不信任 body。

例：RD 提交草稿，response 代表「已提交」，不代表 provision 完成。

```http
POST /api/v1/requests/req-0001/submit
Content-Type: application/json
Idempotency-Key: cmd-submit-0001
X-Demo-Persona: user-rd-commerce
X-Demo-Session: session-example

{"expectedVersion":1}
```

```json
{
  "data": {
    "entityType": "request",
    "entityId": "req-0001",
    "entityVersion": 2,
    "correlationId": "corr-request-0001",
    "changed": [{"entityType":"request","entityId":"req-0001"}]
  },
  "meta": {"requestId":"http-0002","storeRevision":2,"policyVersion":1}
}
```

## 5. Demo-only endpoints

獨立 prefix `/__demo/v1`，不納入 future live backend API。DemoBanner 的 controls 使用此界面；只在 demo mode 註冊。

| Endpoint | 輸入／行為 |
| --- | --- |
| `GET /personas` | 固定可用 persona 摘要，讓導覽選擇角色；不聲稱為登入頁 |
| `POST /persona` | `{personaId}`；更新 identityEpoch，清 query cache；不修改 domain grants |
| `GET /guide` | 當前 scenario 的 prerequisites／completed steps，由 domain selectors 判定 |
| `POST /scenarios` | `{scenarioKey,environmentId?,runId?,jobId?,releaseId?,poolId?}`；只接受已列舉 faults，有目標與前置條件檢查 |
| `POST /reset` | `{confirm:true}`；新 session generation、seed、timer/cache 清理 |
| `POST /clock/advance` | `{ticks:1..60}`；測試與明示「快轉演示」使用，不向業務頁暴露一般時鐘編輯 |

demo command 也使用 Idempotency-Key；reset 的 receipt 與去重記錄存入新 session，由舊 sessionId+key 在 controller 的一次 reset tombstone 識別重放，避免重複 reset 清掉剛開始的新工作。persona switch 不改 shared domain state；scenario mutation 透過同 engine 寫入 evidence/audit，不能由 React 直接 set metrics。

## 6. Mock 行為與故障覆蓋

一般讀寫固定 delay=150ms；`slow-network` 為1500ms、`api-unavailable` 回503，僅由 guide 選擇；baseline 無隨機故障。MsW unhandled `/api/` 請求 fail loudly；第三方 network 不作 demo fallback。沒有真實雲帳密與外部 telemetry script。

Scenario 必須可重現同一結果：capacity-exhausted 在指定 pool 建立明示的 synthetic reservation，使 capacity view 與 approve 檢查得到相同 available；`clear-capacity-fault` 清除該 reservation，兩者都經 engine/audit；provision/build/health/rollback failure 作用於指定 operation 一次，用後清除；post-release-latency 只能注入已成功 release 的 environment；recovery-samples 對指定 incident env 注入3個健康 buckets。容量scenario需指定 poolId，其他scenario按類型指定 environmentId/runId/jobId/releaseId，無關或缺少的target欄位回422。

events 至少包含 eventId、entity refs、type、occurredAt、correlationId。scheduler 在 commit 失敗時不前進 stepIndex；若 quota 無法保存，暫停並提示，而非不斷重试寫入。

未來接真實 backend 時保留 UI/DTO/query keys，替換 transport/bootstrap adapter；移除 persona headers、scenario endpoints、MSW 與 demo store，重新驗證授權、async reconciliation、partial failures 與 API 相容性。這是獨立後續里程碑，不能只改一個 base URL 宣稱完成。


## W1 dashboard 擴充

GET `/dashboard` 沿用原 counters/pendingItems/dataAsOf，新增 `workspace`（kind=rd/ops/admin discriminated union）與 `scope`（authorized project/environment/pool options及filters）。共同區塊為 title/total/items，最多20筆 canonical sourceType/sourceId/title/state/route/dataAsOf/detail；不持久化第二份工作狀態。RD services/work/deliveries、Ops incidents/failures/approvals/capacity/staleness、Admin drafts/integrations/accessChanges。完整 DTO／權限規則見 [W1 contract](../W1-INTEGRATION-CONTRACT.md) 與生成 OpenAPI。

projectId/environmentId 先授權且相互匹配；Ops 新增 provider/poolId，其他中心傳這兩項回422。合法但無權或不匹配 scope 回空投影，不暴露實體存在／名稱／隱藏筆數。未知 keys/enums 回422。保留73個operations與全部原 command；僅擴充既有 dashboard read，Mock 共用原 handler/engine。

W1 revision3：RD `workOwner=all|mine` 納入 URL、完整 query key 和 strict dashboard DTO；mine 只篩工作／交付的實際 requester/creator，不改服務範圍與持久化。切到 Ops/Admin 清除此不適用條件並說明，合法 project/environment 在三工作區均保留。


## W2 integration delta

W2 appends18 operations to the existing73: scoped resource objects/bindings/inventory/service resources/work-items and change read/create/patch/submit/approve/reject/cancel/execute/retry. All use existing request identity, strict Zod validation, typed client, MSW/domain owner and receipt envelope; execute returns202. Current authorization precedes replay; detail404/action403, invalid422 and stale/conflict409. OpenAPI and runtime descriptors are generated from the same91 operation registry. See [W2 integration contract](../W2-INTEGRATION-CONTRACT.md) for exact types, operations, policy, support matrix and owners. Current validation/acceptance is recorded separately in [STATUS](../STATUS.md).


## W3 實作前契約

W3 使用 snapshot3 / dim-gate-w3-v1，同一 envelope1 / dim-gate.demo.v1。嚴格凍結 W1/V2 原始 shape，先驗證原關係後一次原子遷移；只加空 W3 business collections，不補造舊發布的 definition/config/history/grant/persona。真實 W2 accepted merge9162685 的 active Release/ProvisionJob/Kafka fixture SHA2180e098e84bdcccaa35c6573d623577985b2480b780e30a1302965078e6607b 保存命令來源。新增有 executionId 的 configure/traffic abnormal/missing 示範場景。 行為細節與 owner 以 [W3 contract revision2](../W3-INTEGRATION-CONTRACT.md) 為準；這是實作前規格，尚不是通過驗收的宣稱。
