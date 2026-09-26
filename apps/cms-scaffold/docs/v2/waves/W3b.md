# W3b 施工圖：Front 會員區

> 狀態：`DOC_READY`（本檔合併即生效）。上游：[01 §7.1](../01-frontend-sdd.md#71-frontappsweb-front)、[W3](W3.md)、[BW3](BW3.md)、契約：[BW5.openapi.yaml](../contracts/BW5.openapi.yaml)、fixture：[member-entries.json](../contracts/fixtures/member-entries.json)。
>
> 本檔是 W3b 實作者的施工依據。路徑、型別、query key、文案、測試名稱與錯誤分支均已定案；不得把 member 資料改接工作面 API，也不得自行增加會員修改、取消或發布功能。

---

## 1. 範圍

### 1.1 解決的 ID

| ID | 本波完成內容 | 任務卡 | 測試 |
| --- | --- | --- | --- |
| G-08 | 消費 BW5 的 `/api/v1/me/**`，完成自己的寵物、預約列表、預約詳情與建立預約 | W3b-T03～T10 | `member-api.test.ts`、`member-pages.test.tsx`、`appointment-form.test.tsx` |
| C-11 | Clinic header 恢復登入入口；登入後顯示會員選單；合法 `next` 登入後回原會員頁 | W3b-T05～T06 | `member-auth.test.tsx` |
| surface-front AC-10 | 三條會員路由未登入時進登入牆，登入後只顯示自己的資料 | W3b-T05～T08 | `AC10_memberRoutesRequireSessionAndRenderOwnedData` |
| surface-front AC-11 | 讀別人的預約顯示 403 專用畫面，內容不外洩 | W3b-T07～T08 | `AC11_foreignAppointmentShowsForbiddenWithoutContent` |
| surface-front AC-12 | 合法表單呼叫最終 BW5 generic member create，成功留在 Front 詳情頁；request 不含發布欄位 | W3b-T09～T10 | `AC12_validRequestCreatesDraftAndNavigatesToFrontDetail` |
| surface-front AC-13 | `next` 只接受三個已登記的會員路由；外部、Back 與變形路徑一律回 `/clinic/me` | W3b-T05～T06 | `AC13_loginNextUsesMemberAllowlist` |
| surface-front AC-08 | Front 仍只 import `@cms/api/public`；bundle 允許 member schema 的 `publicationState`，其餘工作面路徑與 draft-only 欄位維持禁止；runtime access 只准在 `member.ts` | W3b-T07～T08、T12 | `AC08_publicEntryStillHasNoPublicationState`、`AC08_onlyMemberModuleReadsMemberPublicationState`、`AC08_bundleGuardOnlyExemptsMemberPublicationState`、`npm run test:bundle` |
| V2-AC-14 | 三個會員畫面、403、空狀態、表單錯誤在桌面與 390px 手機的 axe critical／serious 為 0 | W3b-T11 | `front-w3b.spec.ts` 的第 7 個 Playwright test 逐頁檢查 8 個狀態 |
| V2-AC-15 | 會員畫面可見文字不含工程詞、欄位 key、UUID 或英文 publication state；raw identifier 只能在 `member.ts` 轉成 copy key | W3b-T07～T12 | `V2AC15_memberPagesHideEngineeringTermsAndIdentifiers`、source isolation、Playwright 同名測試 |

### 1.2 不做

- 01 §1.2 與 `AGENTS.md`「不要做」全部。
- 不做自助註冊、忘記密碼、OAuth、會員資料修改、寵物 CRUD、預約修改／取消、付款、通知。
- 不呼叫 `/api/v1/entries/**`、`/api/v1/content-types/**`、`/preview/**` 或 Admin API；Front 只用 `@cms/api/public` 匯出的 auth、public 與 member client。`/api/v1/me/**` 是合法的 Front consumer surface，仍放在這個唯一 subpath；不得新增 `@cms/api/member`。
- 不讓會員送 `publicationState`、`ownerPrincipalId`、`version`、`publish`；owner 由伺服器覆蓋，建立結果固定由 API 決定。
- 不新增後端 operation、migration、npm dependency、UI kit 或全域 state store。
- `appointment_request` 沒有獸醫欄位，因此表單沒有獸醫選擇器；不發明 `vetSlug`。
- 不顯示原始 UUID。寵物 ref 以同一位會員的 pet list 對應標題；找不到時顯示固定文案。
- 不把 403 偽裝成 404；會員跨 owner 的資源依 surface-front AC-11 顯示專用 403。

---

## 2. 先決條件

### 2.1 前置波次

| 波次 | 狀態 | 使用的產出 |
| --- | --- | --- |
| W3 | `VERIFIED` | `SiteShell`、`SiteHeader`、`FrontTitle`、`PublicBoundary`、SEO、Clinic 公開頁與既有路由 |
| BW3 | `VERIFIED` | `/api/v1/me/**` 的 owner isolation、建立與 429 |
| BW5 | `DOC_READY`，實作整合前須 `VERIFIED` | `BW5.openapi.yaml` 0.11.0、最終錯誤碼與 `MemberEntry*` schema |
| W0 | `VERIFIED` | `SessionProvider`、`safeReturnTo`、CSRF retry、MSW scenario、copy 規則 |

若 W3 尚未完成，不得以 W2 的舊 Front 頁面猜測整合點。若後端實際 `openapi.yaml` 與 BW5 member operations 不同，停止整合並回報，不在 Front 做相容分支。

### 2.2 環境與指令

- Node 22、npm 10；所有 npm 指令在 `apps/cms-scaffold` 執行。
- JDK 25 只用於最後 `./gradlew test`；前端開發與 Vitest 不需要後端或 Docker。
- 不新增環境變數。API origin、cookie `cms_session`、CSRF 行為沿用 W0。
- production 一律從呼叫當下的 `new Date()` 計算本地分鐘，不讀 fixture clock。Vitest 才使用 fake timers 固定在 fixture 的 `2026-10-01T00:00:00Z`；時區沿用 W3 的 `Asia/Taipei`。
- 防呆：

```bash
python3 -c "import yaml; d=yaml.safe_load(open('docs/v2/contracts/BW5.openapi.yaml')); assert d['info']['version']=='0.11.0'"
python3 -m json.tool docs/v2/contracts/fixtures/member-entries.json >/dev/null
```

---

## 3. 檔案清單

實作者不得碰表外檔案。`package-lock.json` 不變。

| 路徑（相對 `apps/cms-scaffold`） | 動作 | 用途 | 任務卡 |
| --- | --- | --- | --- |
| `docs/v2/contracts/fixtures/member-entries.json` | 已由施工圖提供；不修改 | deterministic member contract | T01 |
| `packages/mocks/fixtures/member-entries.json` | 新增（逐位元組複製） | MSW member 資料 | T02 |
| `packages/mocks/src/db.ts` | 修改 | 載入、reset member fixture | T02 |
| `packages/mocks/src/state.ts` | 修改 | 新增三個 member 專用 deterministic scenario | T02 |
| `packages/mocks/src/handlers/member.ts` | 新增 | `/api/v1/me/**` handlers | T02 |
| `packages/mocks/src/handlers/index.ts` | 修改 | 註冊 member handlers | T02 |
| `packages/mocks/src/member-fixture.test.ts` | 新增 | fixture invariant 與 owner isolation | T01 |
| `packages/api/src/public-entry.ts` | 修改 | member types、client wrapper、query key factory | T04 |
| `packages/api/src/member-api.test.ts` | 新增 | path、body、error normalization、keys | T03 |
| `apps/web-front/src/copy.ts` | 修改 | §5.8 文案 | T06、T08、T10 |
| `apps/web-front/src/shell.tsx` | 修改 | Clinic 登入入口與 `MemberMenu` | T06 |
| `apps/web-front/src/pages/login.tsx` | 修改 | member allowlist 與 fallback | T06 |
| `apps/web-front/src/member.ts` | 新增 | payload parser、日期轉換、寵物 lookup、狀態 label | T08 |
| `apps/web-front/src/member-auth.tsx` | 新增 | `MemberGate`、401 redirect | T06 |
| `apps/web-front/src/pages/member.tsx` | 新增 | `/clinic/me` dashboard、詳情、403 | T08 |
| `apps/web-front/src/pages/appointment-new.tsx` | 新增 | 建立預約表單 | T10 |
| `apps/web-front/src/home.tsx` | 修改 | `ClinicProfile` 下方會員 CTA | T06 |
| `apps/web-front/src/routes.tsx` | 修改 | 三條 member route | T06 |
| `apps/web-front/src/member-auth.test.tsx` | 新增 | C-11、AC-10、AC-13 | T05 |
| `apps/web-front/src/isolation.test.ts` | 修改 | 保留 PublicEntry compile guard；限制 member runtime status access | T07、T08 |
| `apps/web-front/src/member-pages.test.tsx` | 新增 | dashboard、detail、403、states、AC-08、V2-AC-15 | T07 |
| `apps/web-front/src/appointment-form.test.tsx` | 新增 | AC-12、422、429、double submit | T09 |
| `apps/web-front/src/test-utils.tsx` | 修改 | fixture user switch 與 member request recorder | T05 |
| `scripts/check-bundles.mjs` | 修改 | 第二條 `FRONT_ONLY` regex 精確移除 `publicationState|`；其餘 regex 不變 | T08 |
| `e2e-mock/front-w3b.spec.ts` | 新增 | V2-AC-14、V2-AC-15、手機會員流程 | T11 |
| `docs/v2/README.md` | 修改 | W3b 狀態改 `VERIFIED` | T12 |

---

## 4. 契約

### 4.1 API operation

W3b 不新增 API。下表完全採用 BW5；舊 surface-front §7.1 的短路徑只是草案，禁止使用。

| operationId | 方法與最終路徑 | 用途 | request／query | 成功 |
| --- | --- | --- | --- | --- |
| `listMyEntries` | `GET /api/v1/me/content-types/{typeKey}/entries` | `pet`、`appointment_request` 列表 | `size=100`；不送 `state` | `MemberEntryPage` |
| `getMyEntry` | `GET /api/v1/me/entries/{id}` | 預約詳情 | UUID path | `MemberEntry` |
| `createMyEntry` | `POST /api/v1/me/content-types/appointment_request/entries` | 建立預約 | `MemberCreateRequest`；CSRF transport 自動處理 | 201 `MemberEntry` |
| `me` | `GET /api/v1/auth/me` | gate 與 header | 無 | `Me` |
| `login` | `POST /api/v1/auth/login` | 登入 | W0 | `LoginResponse` |
| `logout` | `POST /api/v1/auth/logout` | 登出 | CSRF transport 自動處理 | 204 |

固定參數：

```ts
const MEMBER_LIST_SIZE = 100;
const PET_TYPE = "pet";
const APPOINTMENT_TYPE = "appointment_request";
```

`/clinic/me` 同時查：

```text
GET /api/v1/me/content-types/pet/entries?size=100
GET /api/v1/me/content-types/appointment_request/entries?size=100
```

表單唯一合法 body：

```json
{
  "payload": {
    "pet": "42000000-0000-4000-8000-000000000001",
    "preferredAt": "2026-10-20T01:30:00.000Z",
    "reason": "皮膚搔癢"
  }
}
```

不得出現 `ownerPrincipalId`、`publicationState`、`version`、`publish`。

### 4.2 TypeScript 型別

generated schema 名稱固定為 `MemberEntry`、`MemberEntryPage`、`MemberCreateRequest`。`packages/api/src/public-entry.ts` 匯出：

```ts
export type MemberEntry = components["schemas"]["MemberEntry"];
export type MemberEntryPage = components["schemas"]["MemberEntryPage"];
export type MemberCreateRequest = components["schemas"]["MemberCreateRequest"];

export interface MemberListParams {
  page?: number;
  size?: number;
  sort?: string;
}

export interface AppointmentDraft {
  pet: string;
  preferredAt: string;
  reason: string;
}
```

前端不可把 dynamic payload 直接插入 DOM。`member.ts` 的唯一讀取函式：

```ts
export function memberText(payload: Record<string, unknown>, key: string): string;
export function petTitle(pets: MemberEntry[], petId: unknown): string | null;
export function appointmentStatus(entry: MemberEntry): CopyKey;
export function formatMemberDate(value: unknown): string | null;
export function localDateTimeToIso(value: string): string | null;
export function currentLocalMinute(now: Date = new Date()): string;
```

- `memberText`：值為非空字串才回傳，否則 `""`。
- `petTitle`：只比對 `pets[].id`，回 `pet.title`；不回 id。
- `appointmentStatus` 是 web-front production source 唯一可讀 `entry.publicationState` 的函式：`draft` → `member.status.pending`；`published` → `member.status.confirmed`；`archived` → `member.status.closed`。所有畫面只呼叫 `appointmentStatus(entry)`，不得自行讀欄位。
- `formatMemberDate`：以 `zh-TW`、`dateStyle:"long"`、`timeStyle:"short"` 顯示瀏覽器本地時間；無效值回 null。
- `localDateTimeToIso`：`datetime-local` 非空且可解析才回 `new Date(value).toISOString()`；無效回 null。
- `currentLocalMinute`：檢查 `now.getTime()`；無效日期丟 `RangeError("Invalid date")`。有效時只使用 local getter `getFullYear()`、`getMonth()+1`、`getDate()`、`getHours()`、`getMinutes()`，各數字段補零，回 `YYYY-MM-DDTHH:mm`；秒與毫秒截掉，不做 UTC 轉換。production 無參數呼叫，因 default parameter 每次呼叫都執行 `new Date()`。

### 4.3 API wrapper、query key 與 cache transaction

`@cms/api/public` 增加：

```ts
export const keys = {
  // existing keys unchanged
  member: {
    list: (type: string, params: MemberListParams) =>
      ["member", "entries", type, params] as const,
    detail: (id: string) => ["member", "entry", id] as const,
  },
};

export const memberQueries = {
  list(client: PublicClient, type: string, params: MemberListParams),
  detail(client: PublicClient, id: string),
};

export async function createAppointment(
  client: PublicClient,
  payload: AppointmentDraft,
): Promise<MemberEntry>;
```

固定 keys：

```text
["member","entries","pet",{"size":100}]
["member","entries","appointment_request",{"size":100}]
["member","entry","<id>"]
```

建立成功的前端 cache transaction 依序：

1. `queryClient.setQueryData(keys.member.detail(created.id), created)`。
2. `await queryClient.invalidateQueries({ queryKey: ["member","entries","appointment_request"] })`。
3. `navigate("/clinic/appointments/" + created.id, { replace: true })`。

建立失敗不改任何 cache、不導頁。後端 create 由 BW3 的 `EntryService.create` 單一 transaction 寫 entry 與 `entry.create` audit；前端不得 optimistic insert。讀取無 transaction。

### 4.4 錯誤矩陣

| operation | 狀態／`error.code` | 發生條件 | Front 行為 |
| --- | --- | --- | --- |
| 全部 member | 401 `UNAUTHENTICATED`／`SESSION_EXPIRED` | 未登入或 session 過期 | 清掉 `keys.auth.me()`，replace 到 `/login?next=<目前合法會員路徑>` |
| 全部 member | 403 `SURFACE_FORBIDDEN` | origin 不是 Front | `MemberError` 顯示一般無法載入；不顯示 developer message |
| list | 400 `VALIDATION_FAILED` | query 不合法 | 頁面 `ErrorPublic`＋重試；本波固定 query 不應觸發 |
| list | 404 `CONTENT_TYPE_NOT_FOUND` | type 缺少、停用或沒有 ownerField | 頁面 `ErrorPublic`＋重試，不顯示「沒有資料」 |
| detail | 403 `FORBIDDEN` | 別人的 entry | `MemberForbidden`，`data-testid="member-forbidden"` |
| detail | 404 `ENTRY_NOT_FOUND` | 不存在、刪除、類型停用 | `NotFoundPublic` |
| create | 400 `VALIDATION_FAILED` | body 含禁用欄位或 JSON 不合法 | 表單頂端 `form.error.invalid` |
| create | 403 `FORBIDDEN` | 沒有 create | 表單頂端 `member.error.forbiddenCreate` |
| create | 403 `CSRF_FAILED` | transport 重試一次仍失敗 | 表單頂端 `form.error.session` |
| create | 404 `CONTENT_TYPE_NOT_FOUND` | request type 不可用 | 表單頂端 `member.error.unavailable` |
| create | 415 `MEDIA_TYPE_NOT_SUPPORTED` | Content-Type 錯誤 | 一般送出失敗；client 固定 JSON，不應觸發 |
| create | 422 `FIELD_VALIDATION`／`REF_TARGET_NOT_FOUND` | payload 欄位錯誤／別人的 pet | 依 `error.fields[].field` 對到欄位 |
| create | 429 `RATE_LIMITED` | 一分鐘第 6 次 | 保留輸入，Alert `member.error.rateLimited` |
| 全部 | 500 `INTERNAL_ERROR`／network／invalid response | 依賴服務失敗 | 列表／詳情 `ErrorPublic`；mutation 保留輸入並顯示 `form.error.failed` |

422 mapping 固定：

| server field | UI 欄位 | copy |
| --- | --- | --- |
| `payload.pet` | `pet` | `member.form.pet.invalid` |
| `payload.preferredAt` | `preferredAt` | `member.form.preferredAt.invalid` |
| `payload.reason` | `reason` | `member.form.reason.invalid` |
| 其他 | form alert | `form.error.invalid` |

developer `error.message` 永不顯示。

### 4.5 Deterministic fixture contract

[`member-entries.json`](../contracts/fixtures/member-entries.json) 是唯一來源；`packages/mocks/fixtures/member-entries.json` 必須逐位元組相同。

- 固定 clock：`2026-10-01T00:00:00Z`。
- member A `seed-member-clinic`：Leo、Mochi；兩筆 appointment request。
- member B `seed-member-projects`：Basil；一筆 appointment request。這是 W0/W1 已存在於 `me.json`、`capabilities.json`、`principals.json` 的第二個 member 身分，刻意重用來做 mock cross-owner；不得發明新的 auth user。
- 兩個 `principal` 物件的 id、username、displayName 必須逐欄等於 `me.json` 的同名帳號（A 是 `…0004`，B 是 `…0009`）；member fixture 不建立第二套 principal id。
- 所有 UUID、時間與 owner ref 固定，不得在載入時 `randomUUID()`。
- `crossOwnerForbidden`：B 讀 A 的 `…0001` 必須 403 `FORBIDDEN`，body 不得含 A 的 reason 或 pet id。
- `createCases.valid.response` 是完整的 `MemberEntry`；handler 深拷貝它、append 到目前 member 的 request array 並回 201。不得由 request 臨時補 title、owner、state 或時間；重設 mock 後結果完全相同。
- `createCases.foreignPet` 回 422 `REF_TARGET_NOT_FOUND`，field `payload.pet`。
- list handler 只從目前 user 對應的 member 節點取資料；未知已登入 user 回空 page。

### 4.6 MSW handler

`handlers/member.ts` 精確行為：

1. 每個 handler 先使用既有 `requireUser()`；無 user 回 401。
2. surface 不是 `front` 回 403 `SURFACE_FORBIDDEN`。
3. list 只接受 `pet`、`appointment_request`；其他 type 回 404。
4. `size` 不是 1～100 或 `page` 不是正整數回 400；本 fixture 不實作 sort 改序，順序就是 JSON 順序。
5. detail 在所有 members 中找到 id：owner 是目前 user 則 200；owner 不同則 403；找不到則 404。
6. create 僅允許 `appointment_request`；body 必須正好有 `payload.pet/preferredAt/reason`，多出的 owner、publication state、version 或 publish 回 400。
7. foreign pet 回 fixture 指定 422；缺值／無效日期回 422 fields；成功 append 到目前 member 的 request array 並回固定 response。
8. `?mock=slow`、`error500` 沿用 W0 全域 scenario；`?mock=empty` 對兩種 member list 都回空 page。
9. `packages/mocks/src/state.ts` 的 `Scenario` 與 `SCENARIOS` 同時新增精確值 `memberPetsEmpty`、`memberAppointmentsEmpty`、`rateLimited`。前兩者只讓對應 type 的 list 回空 page，另一種 list 保持 fixture；`rateLimited` 只讓 create 回 429，不以連點計時。Vitest 分別用 `setScenario(...)`；Playwright 分別用同名 `?mock=`。

### 4.7 Front isolation 與 bundle 規則

`@cms/api/public` 維持 Front 唯一 API subpath；member operations 不建立第二個 export path。W3b 必須精確修改兩個既有 guard：

1. `scripts/check-bundles.mjs` 的 `FRONT_ONLY` 第二條 regex 從 `/publicationState|previewToken|includeDraft|includeUnpublished|revisionId|read_draft/` **精確改為** `/previewToken|includeDraft|includeUnpublished|revisionId|read_draft/`；第一條 work API regex 與 `EVERY_APP` 原封不動。原因只限 BW5 `MemberEntry.publicationState` 是 `/api/v1/me/**` 的合法 runtime response；本變更不允許 PublicEntry 取得該欄位。
2. `apps/web-front/src/isolation.test.ts`：
   - 原 `draftFieldsAreNotTyped(entry: PublicEntry)` 中對 `entry.publicationState` 的 `@ts-expect-error` compile-time assertion 原封不動保留。
   - 既有 source forbidden regex 只從該組移除 `publicationState`，其他值原封不動保留。
   - 新增 `AC08_onlyMemberModuleReadsMemberPublicationState`：掃描既有 `sources(SRC)` 結果，允許檔案只有 `join(SRC, "member.ts")`；其餘 production `.ts/.tsx` 只要符合 `/\bpublicationState\b/` 就列為 offender，期望 `[]`。
   - 同一測試讀 `member.ts`，要求 `/entry\.publicationState/g` 恰好 1 次，防止 guard 因完全沒用 member status 而假綠。
   - 新增 `AC08_bundleGuardOnlyExemptsMemberPublicationState`：讀 `scripts/check-bundles.mjs`，斷言仍含完整第一條 `/\/api\/v1\/(entries|content-types|preview|principals|roles|admin|media\/)/` regex、完整 `EVERY_APP` 兩條 regex，以及第二條的新 regex `/previewToken|includeDraft|includeUnpublished|revisionId|read_draft/`；同時斷言不再含舊 regex `/publicationState|previewToken|includeDraft|includeUnpublished|revisionId|read_draft/`。不得用只檢查零散單字的弱 assertion。

`apps/web-front/src/member.ts` 只能在 `appointmentStatus(entry)` 內出現一次 `entry.publicationState`；API package generated type、tests與 fixture 不受 web-front source assertion 限制。這組規則同時完成 surface-front AC-08 與 V2-AC-15。

---

## 5. 模組與元件規格

### 5.1 Clinic header 與 gate

`SiteHeader` 只在 `site.key === "clinic"` 讀一次 auth query：

| auth 狀態 | header |
| --- | --- |
| loading | 預留 80px 寬、`aria-hidden` 的 skeleton |
| anonymous（401 正規化為 null） | link「登入」→ `/login?next=/clinic/me`，`data-testid="member-login"` |
| member | `MemberMenu` 按鈕顯示 displayName；menu：「我的資料」→ `/clinic/me`、「預約看診」→ `/clinic/appointments/new`、「登出」→ `/logout` |
| error 非 401 | 不顯示帳號控制；公開頁仍可用 |

`MemberGate` props：

```ts
interface MemberGateProps { children: React.ReactNode }
```

- pending → `DetailSkeleton`。
- unauthenticated → `<Navigate replace to={"/login?next=" + encodeURIComponent(pathname)} />`。
- authenticated 且 `surfaces.front === true` → children。
- authenticated 但 Front 不可用 → `MemberForbidden`。
- `next` 只保留 pathname，不保留 query 或 hash。

`FRONT_RETURN_ROUTES` 固定：

```ts
[
  "/clinic/me",
  "/clinic/appointments/new",
  "/clinic/appointments/:id"
]
```

登入 fallback 從 `/` 改為 `/clinic/me`。W0 `safeReturnTo` 的外部 URL、`//`、反斜線、Back path 防護不變。

### 5.2 路由

放在 Clinic `SiteShell` children，且必須排在 `/clinic/*` catch-all 前：

```tsx
{ path: "/clinic/me", element: <MemberGate><MemberHome /></MemberGate> },
{ path: "/clinic/appointments/new", element: <MemberGate><AppointmentNew /></MemberGate> },
{ path: "/clinic/appointments/:id", element: <MemberGate><AppointmentDetail /></MemberGate> },
```

三頁都 `noindex,nofollow`、沒有 canonical。未知 appointment id 是 `NotFoundPublic`；foreign id 是 `MemberForbidden`。

W3b 先按上列直接 route element 實作，不建立 lazy parent。W5-T02 才把這三條 route 收進 `member-route.tsx` lazy boundary；W3b-T08 不提前做 W5 的 bundle 拆分。

### 5.3 `/clinic/me` 線框

```text
診所 › 我的資料
我的資料                                      [預約看診]

我的寵物
┌ Leo ─────────────┐ ┌ Mochi ───────────┐
│ 狗               │ │ 貓               │
└──────────────────┘ └──────────────────┘

我的預約
┌ 年度健康檢查 ─────────────────────────────┐
│ Leo · 2026年10月10日 上午10:00 · [待診所確認] │
└───────────────────────────────────────────┘
```

資料來源：pet list 與 appointment request list，兩個 query 並行。

| 狀態 | 畫面 |
| --- | --- |
| loading | pets 與 appointments 各自 `GridSkeleton` |
| pets empty | `EmptyPublished`：`empty.me.pets`＋`empty.me.pets.body` |
| appointments empty | `EmptyPublished`：`empty.me.appointments`，action「預約看診」 |
| 單一 query error | 該 section 就地 `ErrorPublic`；另一 section 保留 |
| default | pet cards 與 appointment links |

`data-testid`：`member-home`、`member-pets`、`member-pet-card`、`member-appointments`、`member-appointment-card`、`member-new-appointment`。

卡片只顯示白名單：

- pet：`title`、`payload.species` 經 copy mapping（`dog`／`cat`；未知顯示 `member.pet.species.other`）。
- appointment：`title`（fallback reason）、pet title、格式化 preferredAt、`appointmentStatus(entry)` 回傳 copy key 所對應的中文 label。
- ownerPrincipalId 永不讀取或渲染。

### 5.4 `/clinic/appointments/:id` 線框

```text
診所 › 我的資料 › 預約詳情
預約詳情                                      [待診所確認]
┌─────────────────────────────────────────────┐
│ 寵物      Leo                               │
│ 希望時間  2026年10月10日 上午10:00            │
│ 原因      年度健康檢查                         │
└─────────────────────────────────────────────┘
```

資料來源：detail query 與 pet list query。detail 先決定 403／404；pet list error 不讓整頁失敗，寵物欄顯示 `member.pet.unavailable`。

`data-testid`：`appointment-detail`、`appointment-status`、`appointment-pet`、`appointment-time`、`appointment-reason`。

狀態：

- detail loading → `DetailSkeleton`。
- 403 → `MemberForbidden`：「沒有權限」「這不是你的資料。」；返回 `/clinic/me`。
- 404 → `NotFoundPublic`。
- 5xx → page `ErrorPublic`。
- 欄位缺少：顯示 `member.value.unavailable`，不顯示 `undefined`、空 UUID 或 developer key。

### 5.5 `/clinic/appointments/new` 線框

```text
診所 › 我的資料 › 預約看診
預約看診
┌─────────────────────────────────────────────┐
│ 寵物 *      [Leo                         ▾] │
│ 希望時間 *  [2026-10-20 09:30              ] │
│ 原因 *      [                              ] │
│             [                              ] │
│                              [取消] [送出預約] │
└─────────────────────────────────────────────┘
```

原生 controlled form，不新增表單 dependency：

```ts
interface AppointmentFormState {
  pet: string;
  preferredAt: string;
  reason: string;
}
```

- pet select 預設第一隻寵物 id；DOM option value 可為 id，但可見文字只能是 pet title。
- preferredAt 是 `<input type="datetime-local">`；每次 `AppointmentNew` render 呼叫 `currentLocalMinute()` 設定 `min`。production 取當下本地分鐘；不得 import fixture、不得傳固定日期、不得在 production source 出現 `2026-10-01`。送出以 `localDateTimeToIso` 轉 ISO。
- Vitest 在每個 datetime case 先 `vi.useFakeTimers()`、再 `vi.setSystemTime(new Date(fixtures.memberEntries.clock))`，結束時 `vi.useRealTimers()`；`Asia/Taipei` 下 fixture clock 的 input `min` 精確為 `2026-10-01T08:00`。另把 system time 移到 `2027-01-02T03:04:30Z`、重新 render，`min` 必須變為 `2027-01-02T11:04`，證明沒有 hard-code。
- reason 是 `Textarea`，trim 後 1～1000 字；空白無效。
- client validation：pet 必須在自己的 pet list；日期可解析且晚於現在；reason 必填且 ≤1000。
- submit 時按鈕 disabled、文案「正在送出…」；不得重複 POST。
- 取消回 `/clinic/me`。
- pets empty：不渲染 form，顯示 `empty.appointments.noPet` 與「請聯絡診所。」
- pet list 5xx：`ErrorPublic`＋重試。
- success 依 §4.3 cache transaction 進 detail。

`data-testid`：`appointment-form`、`appointment-pet`、`appointment-preferred-at`、`appointment-reason`、`appointment-submit`、`appointment-cancel`、`appointment-form-alert`。

### 5.6 Clinic homepage CTA

W3 的 `ClinicProfile` 下方加入單一 CTA：

| session | 文案與 link |
| --- | --- |
| anonymous／auth query error | 「登入後預約」→ `/login?next=/clinic/appointments/new` |
| member | 「預約看診」→ `/clinic/appointments/new` |

修改 `apps/web-front/src/home.tsx` 的 `ClinicProfile`，在 profile 區塊下方渲染 CTA。`data-testid="clinic-appointment-cta"`。CTA 不因 auth query pending 閃爍；pending 顯示 disabled skeleton。

### 5.7 元件清單

| 元件 | 檔案 | props／內部狀態 | query |
| --- | --- | --- | --- |
| `MemberGate` | `member-auth.tsx` | children；無本地狀態 | `keys.auth.me()` |
| `MemberMenu` | `shell.tsx` | 無；DropdownMenu open 由 primitive 管理 | auth |
| `MemberHome` | `pages/member.tsx` | 無 | pet list、appointment list |
| `PetSection` | 同上 | `{ query }` | 呼叫者提供 |
| `AppointmentSection` | 同上 | `{ query, pets }` | 呼叫者提供 |
| `AppointmentDetail` | 同上 | route `id` | detail、pet list |
| `MemberForbidden` | 同上 | 無 | 無 |
| `AppointmentNew` | `pages/appointment-new.tsx` | `AppointmentFormState`、field errors、form error | pet list、create mutation |

只用既有 `@cms/ui`：`Alert`、`Badge`、`Button`、`Card`、`DropdownMenu`、`EmptyState`、`Input`、`Label`、`Select`、`Skeleton`、`Textarea`。不新增 shadcn 元件。

### 5.8 文案表

| key | zh-Hant | 出現位置 |
| --- | --- | --- |
| `member.login` | 登入 | Clinic header |
| `member.menu.label` | 會員選單 | menu aria-label |
| `member.menu.home` | 我的資料 | menu |
| `member.menu.new` | 預約看診 | menu、CTA |
| `member.menu.logout` | 登出 | menu |
| `member.home.title` | 我的資料 | dashboard |
| `member.pets.title` | 我的寵物 | dashboard |
| `member.appointments.title` | 我的預約 | dashboard |
| `member.appointment.detail` | 預約詳情 | detail |
| `member.appointment.new` | 預約看診 | form |
| `member.cta.login` | 登入後預約 | clinic home |
| `member.status.pending` | 待診所確認 | badge |
| `member.status.confirmed` | 已確認 | badge |
| `member.status.closed` | 已結束 | badge |
| `member.pet.species.dog` | 狗 | pet card |
| `member.pet.species.cat` | 貓 | pet card |
| `member.pet.species.other` | 寵物 | pet card |
| `member.pet.unavailable` | 寵物資料無法顯示 | detail |
| `member.value.unavailable` | 資料無法顯示 | detail |
| `member.form.pet` | 寵物 | form |
| `member.form.preferredAt` | 希望時間 | form |
| `member.form.reason` | 原因 | form |
| `member.form.submit` | 送出預約 | form |
| `member.form.submitting` | 正在送出… | form |
| `member.form.cancel` | 取消 | form |
| `member.form.pet.invalid` | 請選擇自己的寵物。 | field error |
| `member.form.preferredAt.invalid` | 請選擇未來的日期與時間。 | field error |
| `member.form.reason.invalid` | 請填寫原因，最多 1000 個字。 | field error |
| `member.error.rateLimited` | 送出次數過多，請稍後再試。 | form alert |
| `member.error.forbiddenCreate` | 這個帳號目前無法送出預約。 | form alert |
| `member.error.unavailable` | 預約服務目前無法使用。 | form alert |
| `form.error.invalid` | 請檢查標示的欄位。 | form alert |
| `form.error.session` | 登入狀態已失效，請重新登入。 | form alert |
| `form.error.failed` | 暫時無法送出，請稍後再試。 | form alert |
| `empty.me.pets` | 尚未登記寵物 | empty |
| `empty.me.pets.body` | 請聯絡診所。 | empty |
| `empty.me.appointments` | 沒有預約 | empty |
| `empty.appointments.noPet` | 無法預約 | form empty |
| `forbidden` | 沒有權限 | 403 |
| `forbidden.body` | 這不是你的資料。 | 403 |
| `forbidden.back` | 回到我的資料 | 403 |

---

## 6. 任務卡

所有行為變更先寫失敗測試。大小 S ≤150 手寫行、M ≤400；不允許 L。

### W3b-T01 【測試先行】fixture invariant

- **目標**：固定 deterministic fixture 與 cross-owner case。
- **輸入**：§4.5 fixture。
- **步驟**：建立 `member-fixture.test.ts`，讀 docs member fixture 與 `me.json`，斷言兩位 member 的 principal 逐欄對齊 auth fixture、owner refs、唯一 UUID、固定 clock、cross-owner target。
- **完成條件**：因 mocks fixture 尚不存在，copy-equality 測試紅燈。
- **驗證**：`npx vitest run packages/mocks/src/member-fixture.test.ts`
- **對應 ID**：G-08、AC-10、AC-11。
- **預估大小**：S。

### W3b-T02 member MSW

- **目標**：實作 §4.5、§4.6。
- **輸入**：T01。
- **步驟**：複製 fixture；擴充 db/reset；建立並註冊 member handlers；依 §4.6 加入 `memberPetsEmpty`、`memberAppointmentsEmpty`、`rateLimited` 三個 scenario。
- **完成條件**：T01 綠；handler 的 fixture 不產生隨機值。
- **驗證**：`npm test -w @cms/mocks`
- **對應 ID**：G-08、AC-10～12。
- **預估大小**：M。

### W3b-T03 【測試先行】member client

- **目標**：固定 paths、types、keys、body 與錯誤。
- **輸入**：T02、BW5。
- **步驟**：建立 `member-api.test.ts`，涵蓋 §7.2。
- **完成條件**：因 exports 不存在而編譯紅燈。
- **驗證**：`npx vitest run packages/api/src/member-api.test.ts`
- **對應 ID**：G-08、AC-12。
- **預估大小**：S。

### W3b-T04 member client implementation

- **目標**：實作 §4.2、§4.3。
- **輸入**：T03。
- **步驟**：在 `public-entry.ts` 匯出 types、keys、queries、create；只走 generated operations。
- **完成條件**：member API tests 全綠；codegen freshness 綠。
- **驗證**：`npm test -w @cms/api && npm run typecheck -w @cms/api`
- **對應 ID**：G-08、AC-12。
- **預估大小**：S。

### W3b-T05 【測試先行】auth、routes、next

- **目標**：固定 C-11、AC-10、AC-13。
- **輸入**：T04。
- **步驟**：擴充 test utils；建立 `member-auth.test.tsx`。
- **完成條件**：新 member routes 仍落 catch-all，至少 AC-10 與 header cases 紅燈。
- **驗證**：`npx vitest run --root apps/web-front src/member-auth.test.tsx`
- **對應 ID**：C-11、AC-10、AC-13。
- **預估大小**：M。

### W3b-T06 gate、header、routes

- **目標**：實作 §5.1、§5.2、§5.6。
- **輸入**：T05。
- **步驟**：新增 `member-auth.tsx`；修改 shell、login、routes、copy；Clinic CTA 接 session。
- **完成條件**：T05 全綠；公開站 regression tests 綠。
- **驗證**：`npx vitest run --root apps/web-front src/member-auth.test.tsx src/site.test.tsx src/clinic.test.tsx`
- **對應 ID**：C-11、AC-10、AC-13。
- **預估大小**：M。

### W3b-T07 【測試先行】會員 dashboard 與詳情

- **目標**：固定 §5.3、§5.4、AC-08 source isolation 及所有狀態。
- **輸入**：T06。
- **步驟**：建立 `member-pages.test.tsx`；依 §4.7 修改 `isolation.test.ts`，先加入唯一 access assertion，不改 bundle script。
- **完成條件**：`member.ts` 不存在，所以唯一 access assertion與頁面 tests 紅燈；`PublicEntry` 的既有 compile assertion仍存在。
- **驗證**：`npx vitest run --root apps/web-front src/isolation.test.ts src/member-pages.test.tsx`
- **對應 ID**：G-08、AC-08、AC-10、AC-11、V2-AC-15。
- **預估大小**：M。

### W3b-T08 會員 dashboard 與詳情

- **目標**：實作 §5.3、§5.4 與 §4.7 bundle/source integration。
- **輸入**：T07。
- **步驟**：建立 `member.ts`、`pages/member.tsx`；加入 copy；依 §5.2 接上三條直接 route element；依 §4.7 精確改 `scripts/check-bundles.mjs` 的第二條 `FRONT_ONLY` regex。lazy member boundary 留給 W5-T02。
- **完成條件**：T07 全綠；`member.ts` 恰有一次 `entry.publicationState`；其他 web-front production source 為 0；PublicEntry compile guard仍綠；production bundle 保留所有其他禁字／禁路徑檢查。
- **驗證**：`npx vitest run --root apps/web-front src/isolation.test.ts src/member-pages.test.tsx && npm run typecheck -w @cms/web-front && npm run build -w @cms/web-front && npm run test:bundle`
- **對應 ID**：G-08、AC-08、AC-10、AC-11、V2-AC-15。
- **預估大小**：M。

### W3b-T09 【測試先行】預約表單

- **目標**：固定 client validation、production-current datetime min、422、429、401、成功 cache transaction。
- **輸入**：T08。
- **步驟**：建立 `appointment-form.test.tsx`；datetime tests 依 §5.5 使用 fake timers 與 fixture clock，再改到 2027 的第二個時間。
- **完成條件**：頁面不存在而紅燈。
- **驗證**：`npx vitest run --root apps/web-front src/appointment-form.test.tsx`
- **對應 ID**：G-08、AC-12、V2-AC-15。
- **預估大小**：M。

### W3b-T10 預約表單

- **目標**：實作 §5.5 的 current-local datetime 與 §4.3、§4.4 mutation 行為。
- **輸入**：T09。
- **步驟**：建立 `appointment-new.tsx`；加入 copy；連接 create mutation。
- **完成條件**：T09 全綠；成功 request 精確等於 §4.1；production source 不含 `2026-10-01`。
- **驗證**：`npx vitest run --root apps/web-front src/appointment-form.test.tsx && npm run lint -w @cms/web-front && npm run typecheck -w @cms/web-front`
- **對應 ID**：G-08、AC-12、V2-AC-15。
- **預估大小**：M。

### W3b-T11 可及性與手機 mock e2e

- **目標**：V2-AC-14、V2-AC-15 的瀏覽器驗收。
- **輸入**：T10。
- **步驟**：建立 `front-w3b.spec.ts`；只用 role＋name 或本檔 test id。
- **完成條件**：本檔 §7.6 精確 8 個 Playwright `test()` 全綠；第 7 個 test 逐一跑 8 個 axe 狀態。
- **驗證**：`npm run e2e:mock -- --grep 'W3b'`
- **對應 ID**：AC-10～13、V2-AC-14、V2-AC-15。
- **預估大小**：M。

這 8 個測試在 W3b 當波執行並合併；之後算入 W5 的 **47-test pre-materialization baseline**，且 W5 materialization 後再算入 **92-test final rerun**，不得在 W5 省略或重編為「尚未執行」。

### W3b-T12 完整閘門與狀態

- **目標**：交付。
- **輸入**：T11。
- **步驟**：跑 §9；README W3b 改 `VERIFIED`；記錄數量與結果。
- **完成條件**：§9 全部打勾。
- **驗證**：§9 指令。
- **對應 ID**：全部。
- **預估大小**：S。

---

## 7. 測試規格

### 7.1 Fixture／MSW tests

| 測試名稱 | 前置／動作 | 斷言 |
| --- | --- | --- |
| `G08_fixtureIsDeterministicAndMatchesDocsContract` | 讀 docs/mocks member JSON 與 docs `me.json` | member JSON bytes 相同；clock 固定；2 members、3 pets、3 existing requests；UUID 唯一；兩個 principal 逐欄等於 `me.json` 同名帳號 |
| `AC10_memberListsContainOnlyCurrentOwnersEntries` | A、B 分別 GET pet/request | A 得 2/2；B 得 1/1；內容不交叉 |
| `AC11_crossOwnerFixtureReturnsForbiddenWithoutPayload` | B GET A request id | 403 `FORBIDDEN`；body 不含 mustNotContain |
| `AC12_validCreateUsesFixedResponseAndForeignPetFails` | valid 與 foreignPet case | valid 201 body 深等於 `createCases.valid.response`；foreign 422 field `payload.pet` |
| `G08_resetRestoresMemberFixture` | create 後 reset，再 list | 新 entry 消失；原始順序與 JSON 一致 |

### 7.2 `member-api.test.ts`

| 測試名稱 | 動作 | 斷言 |
| --- | --- | --- |
| `G08_memberListUsesGenericBw5PathAndStableKey` | list pet size 100 | path/query 精確；key 精確 |
| `G08_memberDetailUsesMeEntryPath` | detail `43000000-0000-4000-8000-000000000001` | path 精確；型別為 MemberEntry |
| `AC12_createAppointmentSendsOnlyAllowedPayload` | create valid | POST generic path；body 無 owner/publication/version/publish |
| `G08_memberErrorsAreApiErrors` | 注入 401/403/404/422/429/500 | status、code、fieldErrors 正規化，不顯示 message 的責任留 UI |

### 7.2.1 Front isolation 與 bundle tests

| 測試／指令 | 斷言 |
| --- | --- |
| `AC08_publicEntryStillHasNoPublicationState`（既有 `draftFieldsAreNotTyped`） | `PublicEntry.publicationState` 仍需 `@ts-expect-error`；若 public schema 增加欄位，typecheck 因 unused directive 失敗 |
| `AC08_onlyMemberModuleReadsMemberPublicationState` | production source 只有 `member.ts` 可命中 identifier，且精確只有 `entry.publicationState` 1 次 |
| `npm run test:bundle` | web-front bundle 可含 member schema 的 `publicationState`；其餘 draft-only fields 與 work/admin paths 仍由原清單拒絕 |
| `AC08_bundleGuardOnlyExemptsMemberPublicationState` | script 含 §4.7 指定的完整新 regex、work API regex 與兩條 `EVERY_APP` regex；完整舊 regex 不存在 |

### 7.3 `member-auth.test.tsx`

| 測試名稱 | 前置／步驟 | 斷言 |
| --- | --- | --- |
| `AC10_memberRoutesRequireSessionAndRenderOwnedData` | 未登入依次開三條 member route | 都 replace 到 `/login?next=<原 pathname>` |
| `C11_clinicHeaderShowsLoginOnlyWhenAnonymous` | anonymous `/clinic` | 「登入」href `/login?next=/clinic/me`；無 member menu |
| `C11_clinicHeaderShowsMemberMenuWhenSignedIn` | A `/clinic` | displayName；我的資料、預約看診、登出 links |
| `AC13_loginNextUsesMemberAllowlist` | 表驅動：三條合法 path、evil URL、`//evil`、Back path、query 變形 | 合法回原路；非法回 `/clinic/me`；不離 Front origin |
| `G08_sessionExpiryReturnsToLoginWithoutQuery` | 已登入後 member list 回 `SESSION_EXPIRED` | auth cache null；login next 只有 pathname |
| `G08_nonFrontPrincipalGetsForbiddenGate` | `surfaces.front=false` | `member-forbidden`；不請求 member list |

### 7.4 `member-pages.test.tsx`

| 測試名稱 | 前置／步驟 | 斷言 |
| --- | --- | --- |
| `AC10_dashboardShowsOwnedPetsAndAppointments` | A 開 `/clinic/me` | Leo、Mochi、A 的兩筆預約；沒有 Basil、B 的 reason |
| `G08_dashboardEmptyStatesAreIndependent` | 依序 `setScenario("empty")`、`setScenario("memberPetsEmpty")`、`setScenario("memberAppointmentsEmpty")`，每 case 前 reset | case 1 兩區 empty；case 2/3 只有對應 empty copy，另一 section 仍顯示 |
| `G08_dashboardSectionErrorDoesNotHideOtherSection` | 只讓 pet handler 500 | pet ErrorPublic；appointments 保留；retry 發 request |
| `G08_appointmentDetailUsesPetTitleAndLocalizedValues` | A 開 request 0001 | Leo、日期、reason、待診所確認；無 UUID/raw `draft` |
| `AC11_foreignAppointmentShowsForbiddenWithoutContent` | B 開 A request | 403 UI；無 A reason、pet id；返回 `/clinic/me` |
| `G08_missingAppointmentShowsNotFound` | 不存在 id | NotFoundPublic，不是 forbidden |
| `G08_detailServerFailureShowsRetry` | error500 | page ErrorPublic；retry |
| `V2AC15_memberPagesHideEngineeringTermsAndIdentifiers` | dashboard、detail、403 | 不含 `PATCH`、`origin`、`publicationState`、`ownerPrincipalId`、`draft`、UUID regex |

### 7.5 `appointment-form.test.tsx`

| 測試名稱 | 前置／步驟 | 斷言 |
| --- | --- | --- |
| `AC12_validRequestCreatesDraftAndNavigatesToFrontDetail` | A 選 Leo、未來時間、reason，送出 | 單一 POST、body 精確；detail cache set；list invalidated；replace 到 fixed id |
| `AC12_clientValidationPreventsInvalidPost` | 空 pet、過去／無效時間、空白與 1001 字 reason | 每欄中文錯誤；0 POST |
| `G08_noPetsShowsContactClinicInsteadOfForm` | pet list empty | noPet copy；無 submit |
| `G08_422MapsKnownFieldsAndHidesDeveloperMessage` | foreign pet／fields response | 對應欄位錯誤；developer message 不在 DOM |
| `G08_429PreservesValuesAndShowsRateLimitCopy` | `mock=rateLimited` | Alert；三欄值不變；留在 new route |
| `G08_401DuringSubmitRedirectsToLogin` | POST 回 session expired | login next new route；不改 cache |
| `G08_403And404CreateUseProductCopy` | 各注入一次 | forbiddenCreate／unavailable；不顯示 code |
| `G08_500PreservesFormAndAllowsRetry` | 第一次 500、第二次成功 | 第一次不導頁；值保留；第二次成功 |
| `G08_doubleSubmitProducesOneRequest` | pending 時連點 | submit disabled；只有 1 POST |
| `G08_datetimeMinUsesCurrentLocalMinuteWithoutHardCode` | fake timers 先設 fixture clock並 render，再設 `2027-01-02T03:04:30Z` 重新 render | `min` 依序 `2026-10-01T08:00`、`2027-01-02T11:04`；production source 不含 `2026-10-01` |
| `V2AC15_formNeverShowsIdsOrFieldKeys` | 422 foreign pet | DOM 無 UUID、`payload.pet`、error code |

### 7.6 Playwright `front-w3b.spec.ts`

使用 fixture 登入 helper；所有定位只用 role＋name 或 `data-testid`。本檔精確建立 8 個 `test()`，在 W3b 執行；第 7 個 test 內依序造訪 8 個狀態，不展開成額外 test。

1. `W3b AC-10 anonymous member routes redirect to login and return after sign-in`。
2. `W3b AC-10 member dashboard shows only owned records at 390px`。
3. `W3b AC-11 foreign appointment is forbidden without leaked content`。
4. `W3b AC-12 create stays on Front and sends no publication field`（監聽 request）。
5. `W3b AC-13 malicious next remains on Front`。
6. `W3b V2-AC-15 visible text contains no engineering term or UUID`。
7. `W3b V2-AC-14 eight member states have no serious accessibility violation`：同一 test 依序檢查 dashboard default、pets empty、appointments empty、detail、forbidden、new form、form validation、rate-limited；每頁 critical／serious 0。
8. 手機每頁 `scrollWidth === clientWidth`；menu 可鍵盤開啟、選 link、關閉。

故障注入只用 `?mock=empty|memberPetsEmpty|memberAppointmentsEmpty|error500|rateLimited|slow` 或 fixture user switch；第 7 個 test 的兩個單區塊 empty 狀態必須使用兩個 member 專用 scenario。不得用真 timer 累積 6 次來測 429。

這 8 個是 W5 計數的一部分：W3b 合併後納入 W5 的 47-test pre-materialization baseline；W5 完成後全部再跑，納入 92-test final rerun。

---

## 8. 失敗模式對照

| FM ID | 失敗情境 | 期望行為 | 測試 | 任務卡 |
| --- | --- | --- | --- | --- |
| W3b-FM01 | 未登入 member route | 401 流程 → login next 原 pathname | 7.3 #1 | T05、T06 |
| W3b-FM02 | 錯誤 surface／Front 不可用 | 403 `SURFACE_FORBIDDEN`／gate forbidden；不打 member list | 7.3 #6、7.2 errors | T03～T06 |
| W3b-FM03 | 別人的 appointment | 403 `FORBIDDEN`；專用 403；不洩漏 | 7.1 #3、7.4 #5 | T01、T02、T07、T08 |
| W3b-FM04 | type 不存在／停用／無 ownerField | 404 `CONTENT_TYPE_NOT_FOUND`；ErrorPublic／service unavailable | 7.2 errors、7.5 #7 | T03、T04、T09、T10 |
| W3b-FM05 | entry 不存在／刪除 | 404 `ENTRY_NOT_FOUND`；NotFoundPublic | 7.4 #6 | T07、T08 |
| W3b-FM06 | client validation | 不送 request；欄位中文錯誤 | 7.5 #2 | T09、T10 |
| W3b-FM07 | server validation／foreign pet | 422；field mapping；不顯示 message、id、key | 7.1 #4、7.5 #4/#10 | T01、T02、T09、T10 |
| W3b-FM08 | create 權限不足 | 403 `FORBIDDEN`；保留 form、產品文案 | 7.5 #7 | T09、T10 |
| W3b-FM09 | CSRF retry 仍失敗 | 403 `CSRF_FAILED`；session copy、保留 form | 7.2 errors、W0 CSRF test、7.5 #7 | T03、T04、T09、T10 |
| W3b-FM10 | rate limit | 429 `RATE_LIMITED`；保留 form | 7.5 #5 | T02、T09、T10 |
| W3b-FM11 | session 在 query／mutation 中過期 | auth cache 清除，回 login next | 7.3 #5、7.5 #6 | T05、T06、T09、T10 |
| W3b-FM12 | API／資料庫／網路 5xx | ErrorPublic 或 form Alert＋重試；不誤顯 empty | 7.4 #3/#7、7.5 #8 | T07～T10 |
| W3b-FM13 | malformed/non-JSON response | W0 正規化 `INVALID_RESPONSE`；同 5xx product copy | 7.2 errors＋W0 client tests | T03、T04、T08、T10 |
| W3b-FM14 | pet ref 無法在自己的 list 對應 | 固定「寵物資料無法顯示」；不顯示 UUID | 7.4 #4 另加 unmatched case | T07、T08 |
| W3b-FM15 | 無 pet | 不顯示 form；聯絡診所 | 7.5 #3 | T09、T10 |
| W3b-FM16 | 重複送出 | pending disabled；單一 POST | 7.5 #9 | T09、T10 |
| W3b-FM17 | version conflict | 不適用：member API 無 PATCH、request 無 version；contract guard 禁止 PATCH/version | 7.2 #3、7.5 #1 | T03、T04、T09、T10 |
| W3b-FM18 | 惡意 `next` | 忽略，回 `/clinic/me` | 7.3 #4、7.6 #5 | T05、T06、T11 |
| W3b-FM19 | member fixture 漂移／隨機 | fixture equality 與 reset deterministic test 失敗 | 7.1 #1/#5 | T01、T02 |
| W3b-FM20 | 手機 overflow／a11y regression | 390px 無水平捲動；axe 0 serious/critical | 7.6 #7/#8 | T11 |
| W3b-FM21 | member status 的合法 `publicationState` 被 W0 raw bundle guard 誤判，或非 `member.ts` 的 Front module 開始讀該欄位 | 第二條 `FRONT_ONLY` regex 只移除 `publicationState\|`；其餘 regex 完整保留；source 只准 `member.ts` 一次 runtime access；PublicEntry compile guard保留 | 7.2.1 全部 | T07、T08、T12 |
| W3b-FM22 | production datetime min 固定為 fixture 日期 | production default 每次呼叫 `new Date()`；fake timers 的兩個不同年份都得到正確 local minute；source 無 fixture 日期 | 7.5 `G08_datetimeMinUsesCurrentLocalMinuteWithoutHardCode` | T09、T10 |

---

## 9. 交付檢查表

- [ ] W3b-T01～T12 全部完成，每張卡的驗證都跑過。
- [ ] fixture valid 且完全一致：

```bash
python3 -m json.tool docs/v2/contracts/fixtures/member-entries.json >/dev/null
cmp docs/v2/contracts/fixtures/member-entries.json packages/mocks/fixtures/member-entries.json
```

- [ ] member operations 只使用 BW5 的 `/api/v1/me/**`；source 沒有 member write 的工作面路徑：

```bash
! rg -n '/api/v1/(entries|content-types|preview|admin)' apps/web-front/src
! rg -n '@cms/api/member' apps/web-front packages/api
```

- [ ] AC-08 bundle/source integration：`scripts/check-bundles.mjs` 的第二條 `FRONT_ONLY` regex 精確從 §4.7 舊值改為新值；第一條 work API regex 與兩條 `EVERY_APP` regex 原封不動。`isolation.test.ts` 保留 `PublicEntry.publicationState` 的 `@ts-expect-error`，並證明 production runtime access 只有 `member.ts` 一次。
- [ ] production datetime 沒有 fixture hard-code：

```bash
! rg -n '2026-10-01' apps/web-front/src --glob '!*.test.*'
```

- [ ] 前端完整閘門：

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run test:bundle
npm run e2e:mock
```

- [ ] 後端 regression：`./gradlew test` 全綠；`./gradlew integrationTest` 由 CI 執行。
- [ ] V2-AC-14：`front-w3b.spec.ts` 精確 8 個 Playwright tests 全綠；其中第 7 個 test 的 8 個 axe 狀態 critical／serious 都是 0。
- [ ] V2-AC-15：Vitest 與 Playwright 都證明 member 畫面沒有工程詞、raw state、field key、UUID。
- [ ] W5 integration 記錄 W3b 的 8 個 tests 已納入 47-test pre-materialization baseline，且列入 92-test final rerun。
- [ ] G-08、C-11、AC-10～13 的 §1.1 測試名稱都出現在 verbose output。
- [ ] `package-lock.json` 沒有變動；沒有新增 dependency。
- [ ] 沒有秘密、密碼或真實個資；fixture 是虛構 deterministic 資料。
- [ ] `docs/v2/README.md` 的 W3b 狀態只改成 `VERIFIED`；相對連結有效。
- [ ] PR 說明列出實際指令、測試數量、任何只由 CI 執行的檢查。
