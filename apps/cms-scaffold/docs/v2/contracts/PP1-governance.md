# PP1 Q25 必要安全子集

日期2026-10-08；主施工圖[PP1](../waves/PP1.md)仍DRAFT。此附錄將已批准Q25與最小UI接線精確化，不授權跳過PP1的runtime優先順序／DOC_READY閘門。沒有產品實作或新增依賴。

## 契約與依賴

權威仍為[BW6 identity](BW6-identity.md) §3.3/3.4/4/7 R25-A/B/P；Java public signatures、constructor相容橋接、denial白名單、transaction順序、locked nonself service fixture全部沿用。原BW6-T17～19可抽取Q25，**不依賴T13/14的Q23投影**。PrincipalGovernanceApiTests只加Q25 cases，不加入roles/lastLoginAt列表要求。

[PP1.openapi.yaml](PP1.openapi.yaml)以基準runtime全檔為底，52 paths／原operations全部保留；只加入PurgeEntryRequest、三個ErrorCode、purge POST契約以及三個SELF operation描述。PatchPrincipalRequest.email與Principal/CreatedPrincipal schema完全不變，沒有Q24/Q23。以x-pp1-source-sha256核對基準，實作時移除此extension；若runtime已前進，逐項保留增量，不盲目覆蓋。根validator須逐物件比對其餘operation/schema與來源相等。

client新增 `export type PurgeEntryRequest = S["PurgeEntryRequest"]`，`purgeEntry(id: string, body?: PurgeEntryRequest): Promise<void>`；只送caller給的body。missing body保留讓server400；不能client自動填DELETE或id。

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

`pages/entries.tsx`的Inspector state以 `entry.id + ":" + entry.version + ":" + (entry.slug ?? "")` 的React key重建；dialog再以pending action key重建，避免open期間切換same-slug不同ID、version或slug沿用輸入。target phrase為非空slug，否則canonical id。mutation payload改為 `{action: Action, id: string, confirmation?: PurgeEntryRequest}`，onConfirm當場捕捉id与raw typed/word；purge只當word===DELETE與raw typed精確等於phrase才建 `{confirmPhrase: word, confirmId: typed}` 並mutate。其餘action保留work呼叫、cache、toast與導航。mutation不得讀到後來變更的entry.id；以捕捉id處理。mutation同時捕捉contentType，完成時只invalidate該次目標的list/audit；用每個key世代的alive ref（effect setup設true、cleanup設false）防止已卸載的Inspector執行navigate/toast/setPending。舊請求仍可完成其正確target，不能對新頁面執行舊回調。alive effect固定為 `useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, [])`，保留Admin既有StrictMode，避免dev setup/cleanup/setup後誤抑制所有回調。新增StrictMode下合法purge仍導航／toast的case，以及pending時切換target、隨後舊請求resolve的測試，斷言新頁不被導航且確認仍空。

`errors.ts`先匹配三新code，再LAST_ADMIN及generic403。既有self隱藏停用／角色lock不移除；server403仍要顯示具體copy。GET detail403的既有redirect不改。

MSW `handlers/admin.ts`僅補SELF與purge body精確比較及優先順序，保持所有其他fixture／投影；不以MSW聲稱跨交易audit已驗證。mock拒絕不改roles/status/session/entries。缺body400，無slug+空id400，不假補確認。

## 精確允許路徑

Java main/test/it前綴沿BW6附錄。下表是PP1 Q25子集的完整source邊界；運維與初始化白名單由主施工圖另定。

| 路徑 | 動作／用途 | 卡 |
| --- | --- | --- |
| main `identity/service/GovernanceDenialAudit.java` | 新增獨立denied helper | Q02 |
| main `identity/service/PrincipalAdminService.java` | SELF及denial wrapper | Q02 |
| main `identity/IdentityException.java`、`api/error/ErrorCode.java` | 三新code／factories | Q02 |
| main `content/service/EntryService.java`、`content/web/AdminContentController.java` | purge唯一確認入口／constructors／controller | Q02 |
| test `PrincipalGovernanceApiTests.java`、`EntryPurgeConfirmationApiTests.java` | 新增Q25 API Red | Q01 |
| test `IdentityAuthTests.java`、`IdentityHardeningTests.java`、`WaveEAcceptanceTests.java` | 舊SELF期望／合法purge caller同步，不刪斷言 | Q02 |
| it `contract/IdentityAuditAtomicWriteTests.java`、`contract/EntryAtomicWriteTests.java` | 合法caller與Q25 denied persistence/fault | Q02/Q03 |
| `services/cms-api/src/main/resources/openapi/openapi.yaml` | Q25 subset同步 | Q02 |
| `packages/api/src/schema.ts`、`generated/schema.d.ts`、`admin.ts` | alias／codegen／explicit body | Q05 |
| `packages/api/src/client.test.ts` | explicit/missing body Red | Q04 |
| `apps/web-admin/src/confirm.tsx`、`pages/entries.tsx`、`errors.ts`、`copy.ts` | 上述最小UI | Q05 |
| `apps/web-admin/src/confirm.test.tsx` | 新增exact confirmation tests | Q04 |
| `apps/web-admin/src/entries.test.tsx`、`principals.test.tsx`、`safety.test.tsx` | 發出的body、錯誤、target變動回歸 | Q04/Q05 |
| `packages/mocks/src/handlers/admin.ts`、`handlers.test.ts` | Q25 mock語義及回歸 | Q04/Q05 |
| `docs/v2/waves/PP1.md`、`contracts/PP1-governance.md` | acceptance狀態與證據連結 | Q06 |

所有短Java路徑從 `services/cms-api/src/<main|test|integrationTest>/java/com/fallrising/cms/` 展開。packages/api短後綴皆在同src下；mock短後綴在packages/mocks/src。generated檔只由 `npm run gen --workspace @cms/api`產生。

## Q25有界任務卡

以下六張只涵蓋Q25，不是PP1完整卡數。手寫差異超400必再拆，不把artifact搬運隱藏為source行数。

### PP1-Q01 API Red（M≤400）

- 目標：證明無確認purge與有第二admin時SELF缺口。
- 輸入：基準ApiFixture、BW6 R25-A/B、本文。
- 步驟：1新增兩測試類的Q25案例；2使用有效session/Origin/CSRF；3記錄self當前200與purge當前204對期待403/400的行為失敗。
- 完成條件：named失敗可查，資料/session/audit計數斷言保留，不以編譯失敗作Red。
- 驗證：`./gradlew test --tests '*PrincipalGovernanceApiTests' --tests '*EntryPurgeConfirmationApiTests' --no-daemon --no-parallel`。
- 對應：Q25、PP1-AC02、FM05/06、BW6 R25-A/B。

### PP1-Q02 Backend Green（M≤400）

- 目標：實現唯一servicegate、SELF及denied audit。
- 輸入：Q01、BW6 identity §3.3/3.4/4、PP1 OAS。
- 步驟：1ErrorCode/factories/helper；2PrincipalAdminService SELF-before-LAST_ADMIN；3EntryService六參DI與明確purge簽名；4controller轉唯一servicegate；5原合法callers／SELF斷言與runtime OAS同步；6移除Red scaffold。
- 完成條件：Q01全綠、舊success/授權/ref/version assertions仍在；不改projection／email／seed。
- 驗證：Q01命令加 `--tests '*IdentityAuthTests' --tests '*IdentityHardeningTests' --tests '*WaveEAcceptanceTests' --tests '*OpenApiContractTests' --tests '*OpenApiCompletenessTests' --tests '*ErrorCodeContractTests'`。
- 對應：Q25、BD09、FM05/06。

### PP1-Q03 JDBC原子性（M≤400）

- 目標：證明獨立denied和成功rollback，不改既有admin guard。
- 輸入：Q02、BW6 R25-P、原兩atomic測試與同DataSource transactions。
- 步驟：1ambient外層rollback後讀denied恰一；2denied audit寫後throw，audit與mutation無部分狀態；3保留success audit failure rollback；4原LAST_ADMIN競爭回歸。
- 完成條件：新連線讀回status/roles/session/entry dependencies不變；unexpected failure不能當成功denial。
- 驗證：`./gradlew integrationTest --tests '*IdentityAuditAtomicWriteTests' --tests '*EntryAtomicWriteTests' --tests '*JdbcIdentityStoreIntegrationTests' --no-daemon --no-parallel`。
- 對應：Q25、BD09、FM05/06。

### PP1-Q04 Client/UI/mock Red（M≤400）

- 目標：測實際送出的確認与stale-target拒絕。
- 輸入：Q02契約、既有Admin fixtures/handlers/tests。
- 步驟：1client explicit/missing body；2dialog兩input及ack、lowercase/whitespace/empty拒絕；3null/empty slug回id；4id/version/slug/action變化與cancel/reopen清空；5pending一次mutation；6SELF/400具體文案；7mock body與SELF優先。
- 完成條件：至少no-body實際請求或missing UI產生預期行為Red；不只快照disabled按鈕。
- 驗證：`npm test --workspace @cms/api -- src/client.test.ts`；`npm test --workspace @cms/mocks -- src/handlers.test.ts`；`npm test --workspace @cms/web-admin -- src/confirm.test.tsx src/entries.test.tsx src/principals.test.tsx src/safety.test.tsx`。
- 對應：Q25、FM05/06/07、BW6-FM93。

### PP1-Q05 Client/UI/mock Green（M≤400）

- 目標：現有Admin可用新確認契約、明確SELF提示。
- 輸入：Q04與本文單一方案。
- 步驟：1codegen/alias；2client explicit body；3dialog optional fields/callback；4Inspector keys與捕捉payload；5copy/error；6mock gate；7Q04轉綠。
- 完成條件：所有Q04通過、其他consumer照舊；Front不新增工作／治理入口。
- 驗證：Q04三條命令；`npm run typecheck`；`npm run gen --workspace @cms/api`再次產生無diff。
- 對應：Q25、FM05/06/07。

### PP1-Q06 子集驗收（S≤150）

- 目標：根review每個R25/FM和完整scope，供PP1正式設定旅程整合。
- 輸入：Q01～Q05命令與diff、主PP1 gate。
- 步驟：1逐一查API/JDBC/UI證據；2OAS僅Q25差異與codegen新鮮；3安全assertions不降；4記錄子集狀態並交prod-like旅程。
- 完成條件：本子集可接受不等於全BW6或PP1驗收；完整PP1仍待六大項。
- 驗證：`git diff --check`、本附錄全部focused命令的已觀察結果；必要原生full gates/CI在主PP1交付時執行。
- 對應：PP1-AC02/06；Q25全部FM。

## 測試向量補充

UI fixture每test reset mocks。`confirm-input`填目標slug或UUID；`confirm-word`填DELETE；checkbox勾選。每個缺欄／空白／大小寫錯誤發出purge請求數必為0；合法case mock捕捉JSON須與實際typed值全等。pending使用可控Promise不sleep；連點只一次。

target更新向量：A(id=a,slug=s,version=1)→B(id=b,slug=s,version=1)、A version=2、A slug=t，皆清空；無slug與空slug都只能UUID。server返回CONFIRMATION_REQUIRED或SELF时檢查toast copy、資料不變、沒有導航404；purge成功仍返回lookup並invalidate原audit/list。

後端拒絕/失敗全部沿BW6 R25，不移除未登入、wrong surface、缺grant、malformed JSON、missing target、refs/CAS與audit faults。以上是精確測試設計，未執行，不能當通過證據。
