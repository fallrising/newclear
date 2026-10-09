# PP1 Q25 必要安全子集

日期2026-10-09；主施工圖[PP1b](../waves/PP1b.md)已通過獨立文件審查，必要CI與文件PR正常合併後DOC_READY生效。此附錄將已批准Q25與最小UI接線精確化，不授權跳過PP1a VERIFIED與PP1b DOC_READY閘門。沒有產品實作或新增依賴。

## 契約與依賴

權威仍為[BW6 identity](BW6-identity.md) §3.3/3.4/4/7 R25-A/B/P；Java public signatures、constructor相容橋接、denial白名單、transaction順序、locked nonself service fixture全部沿用。原BW6-T17～19可抽取Q25，**不依賴T13/14的Q23投影**。PrincipalGovernanceApiTests只加Q25 cases，不加入roles/lastLoginAt列表要求。

[PP1.openapi.yaml](PP1.openapi.yaml)以基準runtime全檔為底，52 paths／原operations全部保留；只加入PurgeEntryRequest、三個ErrorCode、purge POST契約以及三個SELF operation描述。PatchPrincipalRequest.email與Principal/CreatedPrincipal schema完全不變，沒有Q24/Q23。所有4xx/5xx沿既有原生契約使用共用Error<status>引用，包括purge400的Error400；確認錯誤code與範例在主施工圖§4.2。三個ErrorCode枚舉在Q02即同步，其他OAS增量留Q04。以x-pp1-source-sha256核對基準，實作時移除此extension；若runtime已前進，逐項保留增量，不盲目覆蓋。根validator須逐物件比對其餘operation/schema與來源相等。

client新增 `export type PurgeEntryRequest = S["PurgeEntryRequest"]`，`purgeEntry(id: string, body?: PurgeEntryRequest): Promise<void>`；只送caller給的body。missing body保留讓server400；不能client自動填DELETE或id。

**本地子波精確補充**：`packages/api/src/core.ts`新增`CallOptions { retryCsrf?: boolean }`，`call<T>(run,options?:CallOptions)`預設retryCsrf=true。任何403 CSRF_FAILED先csrfToken=null；false直接throw、不fetchCsrf／不重送。admin.purgeEntry唯一傳`{retryCsrf:false}`；下次手動purge由middleware重新fetchCsrf，其他client沿S-03刷新后恰重試一次。無網路／timeout／業務denial重試。新增client regression數實際POST：第一次purge CSRF_FAILED只有一POST，下次manual取新token；一般PATCH原一次retry保持。

## 最小介面設計（單一方案）

沿用 `apps/web-admin/src/confirm.tsx`，不換元件庫。新增以下optional props，其他consumer維持既有操作：

```ts
confirmationWord?: "DELETE";
acknowledgementLabel?: string;
onConfirm: (typed: string, word?: string) => void;
```

原onConfirm零參consumer在TypeScript仍相容。內部維持typed，新增word與acknowledged。當confirmationWord未給，保留既有typed.trim()與phrase比較；purge給定DELETE時，兩欄**不trim**且必須typed===phrase、word===DELETE、acknowledged===true才enabled。acknowledgementLabel只在purge给；Checkbox使用現有@cms/ui。Button closure顯式 `onConfirm(typed, word)`，不可把MouseEvent傳作值。close清三項；資料目標變動以key強制重建。

Purge dialog保留既有target input `confirm-input`，新增DELETE input `confirm-word`、Checkbox `confirm-acknowledgement`，既有submit/cancel testid保持。狀態：default三項空、pending所有input與checkbox／cancel／submit disabled；取消或關閉不發請求；error保留原頁，toast後必須重新開dialog確認；沒有自動重試purge。使用者可見文本只取copy keys，labels以htmlFor連input。

| copy key | zh-Hant | 位置 |
| --- | --- | --- |
| confirm.deletionWordLabel | 請輸入 DELETE | 第二確認欄 |
| confirm.irreversible | 我了解永久刪除後無法復原。 | checkbox |
| error.confirmationRequired | 請重新確認要永久刪除的內容。 | 400 toast |
| error.selfDisable | 無法停用自己的帳號。 | 403 toast |
| error.selfDemotion | 無法移除自己的管理員角色。 | 403 toast |

`pages/entries.tsx`的Inspector state以 `entry.id + ":" + entry.version + ":" + (entry.slug ?? "")` 的React key重建（實際EntryInspectorPage回傳<Inspector>處）；dialog再以pending action key重建，避免open期間切換same-slug不同ID、version或slug沿用輸入。target phrase為非空slug，否則canonical id。mutation payload改為 `{action: Action, id: string, confirmation?: PurgeEntryRequest}`，onConfirm當場捕捉id与raw typed/word；purge只當word===DELETE與raw typed精確等於phrase才建 `{confirmPhrase: word, confirmId: typed}` 並mutate。其餘action保留work呼叫、cache、toast與導航。mutation不得讀到後來變更的entry.id；以捕捉id處理。Inspector新增inFlight ref，onConfirm在mutate前同步設true，alreadytrue不呼叫mutate；onSettled只有alive世代清false。不能只等run.isPending下一render阻止同tickdoubleclick。mutation同時捕捉contentType，完成時先invalidate captured list与exact keys.admin.audit({targetId:payload.id,action:'entry.',size:20})；stale return，不auditAll/nav/toast/setPending；alive才原auditAll全域刷新与UI。nonpurge可更新captured detail；purge維持不invalidate detail以防404閃頁；用每個key世代的alive ref（effect setup設true、cleanup設false）防止已卸載的Inspector執行navigate/toast/setPending。舊請求仍可完成其正確target，不能對新頁面執行舊回調。alive effect固定為 `useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, [])`，保留Admin既有StrictMode，避免dev setup/cleanup/setup後誤抑制所有回調。新增StrictMode下合法purge仍導航／toast的case，以及pending時切換target、隨後舊請求resolve的測試，斷言新頁不被導航且確認仍空。

`errors.ts`先匹配三新code，再LAST_ADMIN及generic403。既有self隱藏停用／角色lock不移除；server403仍要顯示具體copy。GET detail403的既有redirect不改。

MSW `handlers/admin.ts`僅補SELF與purge body精確比較及優先順序，保持所有其他fixture／投影；不以MSW聲稱跨交易audit已驗證。mock拒絕不改roles/status/session/entries。缺body400，無slug+空id400，不假補確認。

## 精確允許路徑

Java main/test/it前綴沿BW6附錄。下表是PP1 Q25子集的完整source邊界；運維與初始化白名單由主施工圖另定。

| 路徑 | 動作／用途 | 卡 |
| --- | --- | --- |
| main `identity/service/GovernanceDenialAudit.java` | 新增獨立denied helper | Q02 |
| main `identity/service/PrincipalAdminService.java` | SELF及denial wrapper | Q02 |
| main `identity/IdentityException.java`、`api/error/ErrorCode.java` | 三新code／factories | Q02 |
| main `content/service/EntryService.java`、`content/web/AdminContentController.java` | purge唯一確認入口／constructors／controller | Q04 |
| test `PrincipalGovernanceApiTests.java` | 新增SELF API Red | Q01 |
| test `EntryPurgeConfirmationApiTests.java` | 新增purge API Red | Q03 |
| test `IdentityAuthTests.java`、`IdentityHardeningTests.java` | 舊SELF期望同步，不刪斷言 | Q02 |
| test `WaveEAcceptanceTests.java` | 合法purge caller同步，不刪斷言 | Q04 |
| it `contract/IdentityAuditAtomicWriteTests.java`、`contract/EntryAtomicWriteTests.java` | 合法caller與Q25 denied persistence/fault | Q04/Q05 |
| `services/cms-api/src/main/resources/openapi/openapi.yaml` | Q25 subset同步 | Q04 |
| `packages/api/src/schema.ts`、`generated/schema.d.ts`、`admin.ts`、`core.ts` | alias／codegen／explicit body | Q07 |
| `packages/api/src/client.test.ts` | explicit/missing body及CSRF次數 Red | Q06 |
| `apps/web-admin/src/confirm.tsx`、`copy.ts` | raw dialog與copy | Q09 |
| `apps/web-admin/src/pages/entries.tsx`、`errors.ts` | Inspector/錯誤copy | Q10 |
| `apps/web-admin/src/confirm.test.tsx` | 新增exact confirmation tests | Q08/Q09 |
| `apps/web-admin/src/entries.test.tsx`、`principals.test.tsx`、`safety.test.tsx` | 發出的body、錯誤、target變動回歸 | Q08/Q10 |
| `packages/mocks/src/handlers/admin.ts`、`handlers.test.ts` | Q25 mock語義及回歸 | Q06/Q07 |
| `docs/v2/waves/PP1.md`、`contracts/PP1-governance.md` | acceptance狀態與證據連結 | D01 |

所有短Java路徑從 `services/cms-api/src/<main|test|integrationTest>/java/com/fallrising/cms/` 展開。packages/api短後綴皆在同src下；mock短後綴在packages/mocks/src。generated檔只由 `npm run gen --workspace @cms/api`產生。

## Q25有界任務卡路由

唯一有界施工卡為[PP1b §6](../waves/PP1b.md#6-任務卡)的Q01–Q10：SELF Red/Green、purge Red/Green、PG denial/fault、client/mock Red/Green、dialog/Inspector Red、dialog Green、Inspector/error Green；E01本地真API旅程、D01交付審查。原六卡不再可直接認領；拆開Backend/UI Green防止超400，不減BW6 R25測試。每張含tests S≤150/M≤400，generated schema另列產物但不替代手寫限制。

## 測試向量補充

UI fixture每test reset mocks。`confirm-input`填目標slug或UUID；`confirm-word`填DELETE；checkbox勾選。每個缺欄／空白／大小寫錯誤發出purge請求數必為0；合法case mock捕捉JSON須與實際typed值全等。pending使用可控Promise不sleep；連點只一次，包含同event-loop兩click。

target更新向量：A(id=a,slug=s,version=1)→B(id=b,slug=s,version=1)、A version=2、A slug=t，皆清空；無slug與空slug都只能UUID。server返回CONFIRMATION_REQUIRED或SELF时檢查toast copy、資料不變、沒有導航404；purge成功仍返回lookup並invalidate原audit/list。

後端拒絕/失敗全部沿BW6 R25，不移除未登入、wrong surface、缺grant、malformed JSON、missing target、refs/CAS與audit faults。以上是精確測試設計，未執行，不能當通過證據。


Q09阶段只confirm全檔与safety named `PP1FM07_nonPurgeConsumersRemainCompatible`，不得跑Q08新SELF/errorcase而誤稱已Green；Q10必须全confirm/entries/principals/safety四檔Green。staleA resolve断言不invalidate B audit或auditAll；alive合法完成仍全域auditAll。same-tickdoubleclick由同步inFlight阻擋，test不靠下一render。
