# BW6 內容與媒體施工附錄

狀態：文件交付候選，供 [BW6 契約](../waves/BW6.md#4-契約)、[模組規格](../waves/BW6.md#5-模組與元件規格)、[任務卡](../waves/BW6.md#6-任務卡)、[測試規格](../waves/BW6.md#7-測試規格)與[失敗模式](../waves/BW6.md#8-失敗模式對照)整合。DOC_READY 隨本波文件 PR 合併生效；本文沒有宣稱產品已實作。基準為 W5 合併結果；本附錄只定 Q-12、Q-14、Q-17、Q-20。任務卡採主施工圖全波 ID，依先決條件排序。

## 1. 範圍、批准規則與先決條件

依 [01 §13](../01-frontend-sdd.md#13-開放問題與已知衝突)、[02 §7](../02-backend-sdd.md#7-後端波次)與 [BQ-14 B 批准紀錄](../bw6-refinement.md#決定紀錄)，本附錄固定下列行為：

- Q-12 新建 field key 套用 ^[A-Za-z][A-Za-z0-9_]{0,62}$；不改既有 field/entry/revision/ref/index key。type key 的舊 regex 不改。
- Q-14 GET /api/v1/media 的 page 為 **0 起算，預設0**，size 預設24、1～100。q 經 Java String.strip() 後比對 title **或** originalFilename，不分大小寫的字面包含。列表只含 status=available 且 deletedAt=null；沒有 includeDeleted、回收列表、restore 或 purge 新端點。既有私有 deleted metadata200、私有檔案410、公開metadata/檔案404保留。
- Q-17 enumLabels 只加到 enabled、visibility=public、type=enum 的 PublicField。非enum省略此key；不輸出 back/internal/disabled field或其labels。
- Q-20 通用 nullable pack 由 ContentTypeSeed 設定；album/photo=album，clinic_profile/owner/pet/vet/visit/appointment_request=clinic，project/issue/milestone=projects，page與自訂類型=null。既有非null pack保留。entryCount 包含所有未軟刪狀態；publishedCount只數未軟刪且 publicationState=published，包含private/unlisted。每批類型一次aggregate，不逐type跑count。
- ContentTypeSeed 的 @Order(100) 保留；BQ-14 B 的 identity finalization 在它之後執行，由主施工圖治理附錄負責。kernel controller/store不得硬編碼demo mapping。
- 前置波次BW0～BW5、W0～W5為VERIFIED。Java25、PostgreSQL16、Node24.18.0沿用既有閘門。test不需要Docker；integrationTest使用既有Testcontainers。密碼僅引用 cms.identity.seed-password／CMS_E2E_PASSWORD變數，不寫值。
- 不改三面、session/CSRF、依賴、已合併migration、workflow；不新增role/matcher原語、不設定defaultVisibility/surfaces。W6畫面、文案、axe與截圖另波實作。

Media0-based並非Content entry的1-based。主施工圖共享整合卡新增 work.mediaPage(params,signal?)；舊 work.mediaList(signal?) 保持回完整available library的 {items}，自行以page0/size100逐頁取完並保留abort/total-change/duplicate-id guard，不可使用現有1-based completeList。keys.media.page(params)與舊keys.media.list分開；舊LibraryBody/LibraryTab在W6前不改。契約型別MediaAssetPage由主施工圖整檔OpenAPI與codegen卡提供。

## 2. 現況證據與實作檔案清單

現況來源均已在基準source逐行核對：

| 問題 | 現況與入口 |
| --- | --- |
| Q-12 | [AdminContentController](../../../services/cms-api/src/main/java/com/fallrising/cms/content/web/AdminContentController.java):46、132–168，field key僅required/length/duplicate；[舊API邊界測試](../../../services/cms-api/src/test/java/com/fallrising/cms/AdminInputValidationApiTests.java):187–200接受emoji key。 |
| Q-14 | [MediaController](../../../services/cms-api/src/main/java/com/fallrising/cms/media/web/MediaController.java):59–79、[MediaService](../../../services/cms-api/src/main/java/com/fallrising/cms/media/service/MediaService.java):141–147/186–227、[JdbcMediaStore](../../../services/cms-api/src/main/java/com/fallrising/cms/media/store/JdbcMediaStore.java):81–87/200–221。list無分頁，private get授權後可讀deleted；檔案410；JSON未輸出deletedAt。 |
| Q-17 | [PublicContentController](../../../services/cms-api/src/main/java/com/fallrising/cms/content/web/PublicContentController.java):51–59/95–105、[FieldRecord](../../../services/cms-api/src/main/java/com/fallrising/cms/content/domain/FieldRecord.java):30–35。labels已有存儲，公開投影省略。 |
| Q-20 | [ContentTypeRecord](../../../services/cms-api/src/main/java/com/fallrising/cms/content/domain/ContentTypeRecord.java):11–85、[ContentStore](../../../services/cms-api/src/main/java/com/fallrising/cms/content/store/ContentStore.java):56、[JdbcContentStore](../../../services/cms-api/src/main/java/com/fallrising/cms/content/store/JdbcContentStore.java):278–283/648–664。無pack與bulk published count。 |
| migration | [V9 SQL](../../../services/cms-api/src/main/resources/db/migration/V9__audit_retention.sql)之外已有 [Java V10](../../../services/cms-api/src/main/java/db/migration/V10__index_ref_fields.java):3–4；下一版本是V11。 |
| seed順序 | [ContentTypeSeed](../../../services/cms-api/src/main/java/com/fallrising/cms/content/service/ContentTypeSeed.java):25/34/155–188；已是Order100、idempotent設定。 |
| query與安全回歸 | [MediaStoreContract](../../../services/cms-api/src/test/java/com/fallrising/cms/contract/MediaStoreContract.java):53–60/96–125、[MediaBatchQueryCountTests](../../../services/cms-api/src/integrationTest/java/com/fallrising/cms/contract/MediaBatchQueryCountTests.java):27–66、[MediaErrorCodeApiTests](../../../services/cms-api/src/test/java/com/fallrising/cms/MediaErrorCodeApiTests.java):46–74。 |

以下路徑相對 apps/cms-scaffold；只列本附錄的後續實作清單，這次細化不寫產品：

| 路徑 | 操作 | 用途／卡 |
| --- | --- | --- |
| services/cms-api/src/main/java/com/fallrising/cms/content/web/AdminContentController.java | 修改 | key驗證、bulk counts接線；BW6-T06/BW6-T04 |
| services/cms-api/src/test/java/com/fallrising/cms/AdminInputValidationApiTests.java | 修改 | key格式／Unicode其他欄位／無部分寫入；BW6-T05 |
| services/cms-api/src/main/java/com/fallrising/cms/media/query/MediaListQuery.java | 新增 | parser與long offset；BW6-T07/BW6-T08 |
| services/cms-api/src/main/java/com/fallrising/cms/media/query/MediaPage.java | 新增 | store/service分頁record；BW6-T07/BW6-T08 |
| services/cms-api/src/main/java/com/fallrising/cms/media/store/MediaStore.java | 修改 | queryMedia介面；BW6-T07/BW6-T08 |
| services/cms-api/src/main/java/com/fallrising/cms/media/store/JdbcMediaStore.java | 修改 | SQL count/page/batch variants；BW6-T08 |
| services/cms-api/src/main/java/com/fallrising/cms/media/store/InMemoryMediaStore.java | 修改 | 同契約filter/order/page；BW6-T08 |
| services/cms-api/src/main/java/com/fallrising/cms/media/MediaException.java | 修改 | existing VALIDATION_FAILED factory；BW6-T08 |
| services/cms-api/src/test/java/com/fallrising/cms/media/query/MediaListQueryTests.java | 新增 | parser案例；BW6-T07 |
| services/cms-api/src/test/java/com/fallrising/cms/contract/MediaStoreContract.java | 修改 | same tests兩種store；BW6-T07 |
| services/cms-api/src/main/java/com/fallrising/cms/media/service/MediaService.java | 修改 | 授權先行、page回應、deletedAt投影；BW6-T10 |
| services/cms-api/src/main/java/com/fallrising/cms/media/web/MediaController.java | 修改 | list envelope、metadata授權不掃整庫；BW6-T10 |
| services/cms-api/src/test/java/com/fallrising/cms/MediaListApiTests.java | 新增 | list/default/validation/授權；BW6-T09 |
| services/cms-api/src/test/java/com/fallrising/cms/MediaErrorCodeApiTests.java | 修改 | deleted metadata200和nullable欄位；BW6-T09 |
| services/cms-api/src/test/java/com/fallrising/cms/media/service/MediaListServiceTests.java | 新增 | 授權先於parser/store與store failure；BW6-T09 |
| services/cms-api/src/integrationTest/java/com/fallrising/cms/contract/MediaBatchQueryCountTests.java | 修改 | list SQL數與metadata無library掃描；BW6-T09 |
| services/cms-api/src/main/java/com/fallrising/cms/content/web/PublicContentController.java | 修改 | public enum labels；BW6-T12 |
| services/cms-api/src/test/java/com/fallrising/cms/TypeSchemaTests.java | 修改 | public visibility與Admin counts；BW6-T11/BW6-T03 |
| services/cms-api/src/main/java/com/fallrising/cms/content/domain/ContentTypeRecord.java | 修改 | 17-component record與相容constructor；BW6-T01/BW6-T02 |
| services/cms-api/src/main/java/com/fallrising/cms/content/store/ContentStore.java | 修改 | conditional pack與bulk counts；BW6-T01/BW6-T02/BW6-T03/BW6-T04 |
| services/cms-api/src/main/java/com/fallrising/cms/content/store/JdbcContentStore.java | 修改 | insert/mapper pack、conditionalupdate、aggregate；BW6-T02/BW6-T04 |
| services/cms-api/src/main/java/com/fallrising/cms/content/store/InMemoryContentStore.java | 修改 | preserve pack與same store契約；BW6-T02/BW6-T04 |
| services/cms-api/src/main/resources/db/migration/V11__content_type_pack.sql | 新增 | 只新增nullable通用欄位；BW6-T02 |
| services/cms-api/src/main/java/com/fallrising/cms/content/service/ContentTypeSeed.java | 修改 | seed-only mapping與null backfill；BW6-T02 |
| services/cms-api/src/test/java/com/fallrising/cms/contract/ContentStoreContract.java | 修改 | pack/counters共用契約；BW6-T01/BW6-T03 |
| services/cms-api/src/test/java/com/fallrising/cms/content/service/ContentTypeSeedTests.java | 修改 | new/old/custom pack保存；BW6-T01 |
| services/cms-api/src/integrationTest/java/com/fallrising/cms/contract/TypePackMigrationTests.java | 新增 | V10→V11無內容改寫；BW6-T01 |
| services/cms-api/src/main/java/com/fallrising/cms/content/query/TypeEntryCounts.java | 新增 | long counters；BW6-T03/BW6-T04 |
| services/cms-api/src/main/java/com/fallrising/cms/content/web/ContentProjection.java | 修改 | adminTypeSchema；BW6-T04 |
| services/cms-api/src/integrationTest/java/com/fallrising/cms/contract/TypeEntryCountsQueryCountTests.java | 新增 | 1/12 type固定一次SQL；BW6-T03 |
| services/cms-api/src/main/resources/openapi/openapi.yaml | 修改 | 各API Green卡同步當次operation/schema，不能延到最末共享卡；BW6-T06/BW6-T10/BW6-T12/BW6-T04 |

InMemory/JDBC的既有contract runners不改：InMemoryMediaStoreContractTests、JdbcMediaStoreContractTests、InMemoryContentStoreContractTests、JdbcContentStoreContractTests，新增抽象test方法會自動各跑一次。

主施工圖共享卡另列：packages/api/src/generated/schema.d.ts、schema.ts、work.ts、keys.ts、client.test.ts、packages/mocks/src/handlers/work.ts/handlers/admin.ts、fixture來源及生成檔。runtime OpenAPI由本附錄四個API Green卡漸進同步，末尾共享卡再核對它與整檔BW6契約、執行codegen，不等到最後才改runtime schema。public handler仍讀public fixture，labels由fixture更新；既有db.media asset可直接存新增deletedAt，不要求更改db.ts/public handler。shared OAS新增MediaAssetPage，CreateFieldRequest.key pattern、MediaAsset.deletedAt、PublicField.enumLabels、AdminContentType.pack/counts按§3；移除GET /media的MediaAssetList引用。舊MediaAssetList schema可保留給legacy {items} alias，但不是listMedia wire response。

## 3. API operation、型別與例子

沿用既有ErrorEnvelope。本附錄不新增ErrorCode。400 VALIDATION_FAILED、422 FIELD_VALIDATION及error.fields[i].code=INVALID_FORMAT都是現有enum；401 UNAUTHENTICATED/SESSION_EXPIRED、403 FORBIDDEN/SURFACE_FORBIDDEN/ACCOUNT_DISABLED/ACCOUNT_LOCKED由既有身份層產生。CSRF失敗403 CSRF_FAILED只發生寫入。

| method／path | surface／action | request與response | 分支錯誤 |
| --- | --- | --- | --- |
| POST /api/v1/admin/content-types | ADMIN，MANAGE_TYPES | 既有CreateContentTypeRequest；fields[].key pattern；201 AdminContentType含pack/counts | 400 invalid JSON；401；403身份/權限/CSRF；422 FIELD_VALIDATION：required、長度、格式、重複按§4收集；500 INTERNAL_ERROR。 |
| GET /api/v1/media | BACK或ADMIN，MANAGE_MEDIA | page/size/q；200 MediaAssetPage，required items,total,page,size；additionalProperties=false | 401；403 FRONT或無action；400 VALIDATION_FAILED：page/size/q重複或數值不合§5；500 INTERNAL_ERROR：DB/store失敗。 |
| GET /api/v1/media/{id} | BACK或ADMIN，MANAGE_MEDIA | 200 MediaAsset，required deletedAt，string date-time nullable | 400無效UUID；401；403；404 MEDIA_NOT_FOUND不存在；500。deleted metadata仍200。 |
| POST /api/v1/media | BACK或ADMIN，MANAGE_MEDIA | 既有multipart；201 MediaAsset多deletedAt:null | 原400/401/403/409 MEDIA_QUOTA_EXCEEDED/413 MEDIA_FILE_TOO_LARGE/415 MEDIA_UNSUPPORTED_TYPE/500全部保留。 |
| GET /api/v1/public/content-types | FRONT公開讀，沿用READ_PUBLISHED filter | 200 PublicContentTypeList；PublicField.enumLabels可省略、object的additionalProperties:string | 既有身份失敗與500回應保留；非enum不含labels。 |
| GET /api/v1/admin/content-types | ADMIN，MANAGE_TYPES | 200 AdminContentTypeList；每type required pack、entryCount、publishedCount | 401；403；500，不新增list query/pack寫入。 |
| POST /api/v1/admin/content-types/{typeKey}/enable與disable | ADMIN，MANAGE_TYPES | 200 AdminContentType同三欄 | 400；401；403/CSRF；404 CONTENT_TYPE_NOT_FOUND；500；沿用交易＋audit。 |

不改私有檔案與公開媒體operation。私有檔案的deleted為410 MEDIA_GONE，公開metadata/file的deleted為404 MEDIA_NOT_FOUND；PublicEntry/MemberEntry內嵌媒體仍走既有可讀性判斷，新增欄位publicViewer固定null，不洩漏刪除時間。

MediaAsset.deletedAt對所有MediaAsset回應required且nullable；只有authorized private metadata能是非null。PublicField.enumLabels不required、不nullable，空labels回{}，type enum無labels依既有FieldRecord空map處理。AdminContentType.pack required且nullable string，不把三demo做成generic schema enum；counts required integer/int64/minimum0。

成功list：GET /api/v1/media?page=0&size=24&q=Sun
~~~json
{"items":[],"total":0,"page":0,"size":24}
~~~
空結果仍保留傳入page/size，不改page到最後一頁。GET /api/v1/media?page=-1錯誤：
~~~json
{"error":{"code":"VALIDATION_FAILED","message":"page must be a nonnegative integer"},"requestId":"example-request"}
~~~
requestId由既有handler產生；例子不指定真實session。新建合法fields request：
~~~json
{"key":"bw6_probe","fields":[{"key":"A","type":"string"},{"key":"image_0","type":"media-ref"}]}
~~~
新建a.b錯誤的fields元素：
~~~json
{"field":"fields[0].key","code":"INVALID_FORMAT","message":"fields[0].key must match ^[A-Za-z][A-Za-z0-9_]{0,62}$"}
~~~
公開enum field成功：
~~~json
{"key":"specialty","type":"enum","required":false,"enumLabels":{"general":"一般"}}
~~~
public string field成功：
~~~json
{"key":"title","type":"string","required":true}
~~~
Admin新增projection（其餘既有properties全部保留）：
~~~json
{"pack":"clinic","entryCount":5,"publishedCount":3}
~~~

## 4. Q-12 完整分支

保留 AdminContentController.FieldBody／TypeBody record，不加Bean Validation annotation來取代完整收集。

validateType(TypeBody body)的fields[i]按原request順序執行：

1. field=null：加FieldError(fields[i],REQUIRED)，continue。
2. key=null或isBlank：加fields[i].key REQUIRED。
3. 否則codePointCount>63：加TOO_LONG，維持原長度訊息。
4. 否則不matches ^[A-Za-z][A-Za-z0-9_]{0,62}$：加INVALID_FORMAT，訊息如§3。
5. 否則keys.add(key)=false：加DUPLICATE。
6. 不論key錯誤仍照原規則收集field.type與refTarget錯誤；合法key才進入keys集合。key比較大小寫敏感，A與a可並存。
7. 前面的type/displayName/pluralDisplayName/titleField/slugPolicy驗證不改。任一error時，在insertType/insertField/audit之前丟ContentException.fieldErrors(errors)，422；沒有部分寫入。

舊emoji field-key成功case改以a加62個k測63界線；另測emoji keyINVALID_FORMAT。Unicode displayName80、plural80、titleField63、refTarget63仍成功；64字元key仍TOO_LONG，不改成INVALID_FORMAT以掩蓋長度回歸。既有a.b key讀寫、不改名的案例透過直接store插入legacyfield建立；不要透過新建API建立不合法前置資料。保留既有type key小寫／最少2字元規則。

## 5. Q-14 query、SQL與controller流程

### 5.1 Java型別與parser

新增com.fallrising.cms.media.query.MediaListQuery：
~~~java
public record MediaListQuery(int page, int size, String q) {
    public static final int DEFAULT_SIZE = 24;
    public static final int MAX_SIZE = 100;
    public MediaListQuery {
        if (page < 0) throw MediaException.invalidParameter("page must be a nonnegative integer");
        if (size < 1 || size > MAX_SIZE) throw MediaException.invalidParameter("size must be between 1 and 100");
        q = q == null ? "" : q.strip();
    }
    public long offset() { return (long) page * size; }
    public static MediaListQuery parse(Map<String, String[]> parameters) {
        int page = number(parameters, "page", 0);
        int size = number(parameters, "size", DEFAULT_SIZE);
        String q = single(parameters, "q");
        return new MediaListQuery(page, size, q);
    }
    private static String single(Map<String, String[]> parameters, String name) {
        if (!parameters.containsKey(name)) return null;
        String[] values = parameters.get(name);
        if (values == null || values.length != 1 || values[0] == null)
            throw MediaException.invalidParameter(name + " must not repeat or be empty");
        return values[0];
    }
    private static int number(Map<String, String[]> parameters, String name, int fallback) {
        String raw = single(parameters, name);
        if (raw == null) return fallback;
        String message = "page".equals(name)
            ? "page must be a nonnegative integer" : "size must be between 1 and 100";
        if (!raw.matches("[0-9]+")) throw MediaException.invalidParameter(message);
        try { return Integer.parseInt(raw); }
        catch (NumberFormatException exception) { throw MediaException.invalidParameter(message); }
    }
}
~~~
imports：com.fallrising.cms.media.MediaException、java.util.Map。上述為完成結果；Red卡的compile-only scaffold在Green卡替換成此實作。

single：沒有key回null；有key但values=null、length!=1或values[0]=null丟invalidParameter(name+" must not repeat or be empty")；其餘原字串回傳。number：single=null回fallback；raw不matches [0-9]+丟page上述訊息或size上述訊息；Integer.parseInt溢位同樣400。parse依page、size、q順序取得，page預設0、size24；建record由canonical constructor檢查size範圍與normalize q。q允許空字串；重複q即400。page/size的空字串、正負號、空白、decimal、非數字都400；前導0接受。只解析page/size/q，其他既有未定義參數不影響結果，includeDeleted即使傳true也不能含deleted。認證/授權必須先於parse。

MediaException新增：
~~~java
public static MediaException invalidParameter(String message) {
    return new MediaException(ErrorCode.VALIDATION_FAILED, message);
}
~~~

新增同package MediaPage：
~~~java
public record MediaPage(List<MediaAsset> items, long total, int page, int size) {
    public MediaPage { items = List.copyOf(items); }
}
~~~
imports：media.domain.MediaAsset、java.util.List。

MediaStore新增 MediaPage queryMedia(MediaListQuery query)。舊listAvailable/findAll/配額方法保留，避免改動既有store契約與quota語義。queryMedia保證items限size、total是完整filtered數、page/sizeecho、deleted不含在items/total。

### 5.2 JDBC SQL

JdbcMediaStore新增queryMedia，執行以下順序：

1. where固定為status='available' AND deleted_at IS NULL。q非空再加(title ILIKE ? ESCAPE '\' OR original_filename ILIKE ? ESCAPE '\')。
2. pattern = "%" + escapeLike(query.q()) + "%"；escapeLike依序將 \→\\、%→\%、_→\_。使用prepared parameters，不把q拼入SQL。两個ILIKE參數同pattern。
3. 執行filtered count，再page SQL，count與page使用完全相同where/綁定filter。
4. page rows空：不查variants，回MediaPage(empty,total,page,size)。
5. 非空：一次取得此page IDs的variants，按mediaId group，再用現有withVariants(asset,List<MediaVariant>)逐列組回原page順序；不可呼叫現有withVariants(asset)或findAll造成逐列／重複media查詢。

完整無搜尋SQL：
~~~sql
SELECT COUNT(*) FROM cms_media
WHERE status = 'available' AND deleted_at IS NULL;
SELECT * FROM cms_media
WHERE status = 'available' AND deleted_at IS NULL
ORDER BY created_at DESC, id::text COLLATE "C" ASC
LIMIT ? OFFSET ?;
~~~
page參數為query.size()、query.offset()（long）。有搜尋SQL：
~~~sql
SELECT COUNT(*) FROM cms_media
WHERE status = 'available' AND deleted_at IS NULL
  AND (title ILIKE ? ESCAPE '\' OR original_filename ILIKE ? ESCAPE '\');
SELECT * FROM cms_media
WHERE status = 'available' AND deleted_at IS NULL
  AND (title ILIKE ? ESCAPE '\' OR original_filename ILIKE ? ESCAPE '\')
ORDER BY created_at DESC, id::text COLLATE "C" ASC
LIMIT ? OFFSET ?;
SELECT * FROM cms_media_variant WHERE media_id IN (?, ...);
~~~
最後IN的?數等於非空page的distinct IDs數；ID由page rows取得，最多100。SQL標點中的省略部分只代表由既有placeholders(int)產生參數位置，不能拼接UUID值。只有count/page兩query，或非空含variants三query，與page item數無關。

### 5.3 InMemory與service

InMemoryMediaStore.queryMedia先從assets.values()取得一份List快照；filter MediaAsset.available()；q非空比對title或originalFilename的toLowerCase(Locale.ROOT).contains(q.toLowerCase(Locale.ROOT))；order Comparator.comparing(MediaAsset::createdAt).reversed().thenComparing(a→a.id().toString())；total為整份matches.size()；以long offset與size取子頁，不把offset轉int到確認offset<total以前；page rows用既有withVariants hydrates。query page=Integer.MAX_VALUE空頁仍回正確total，沒有乘法overflow。

MediaService新增／替換方法：
~~~java
public void requireManage(Principal principal, Surface surface);
public MediaPage list(Principal principal, Surface surface, Map<String, String[]> parameters);
~~~
requireManage只呼叫authorization.require(principal,MANAGE_MEDIA,null,null,surface)。list先requireManage，再MediaListQuery.parse，再store.queryMedia。舊二參數list刪除；只有MediaController.list/get兩個call sites，按下面改。service不catch或吞掉store例外。

MediaController.list(HttpServletRequest request)：
1. back(request)既有session/FRONT拒絕保留。
2. result=media.list(identity.principal(),identity.surface(),request.getParameterMap())。
3. 回LinkedHashMap items（每asset用media.json(asset,false)）、total、page、size；不再store全庫後切頁。
MediaController.get(UUID,HttpServletRequest)先back(request)，再requireManage；media.get(id)後json(false)。不用list授權，metadata單查不附帶library查詢。

MediaService.json(MediaAsset,boolean)在width/height後加deletedAt：publicViewer ? null : asset.deletedAt()。回傳LinkedHashMap允許null，不改成Map.of。只投影指定APIproperties；不輸出ownerPrincipalId/originalFilename/checksum/status/storedBytes/objectKey。softDelete、privateBytes/publiclyReadable/publicBytes/publicExpander的既有判斷與audit/交易全部保留。q能搜尋originalFilename不代表DTO須輸出它。

## 6. Q-17 公開enum投影

不改ContentProjection.fieldSchema（它包含工作面的helpText/refTarget/visibility），不直接重用它公開。

PublicContentController.publicType(ContentTypeRecord type)保持type enabled與READ_PUBLISHED filter。fields流保持enabled且visibility public，再呼叫新增private Map<String,Object> publicField(FieldRecord field)：

1. LinkedHashMap依序put key、type、required。
2. fieldType等於enum才put enumLabels=field.enumLabels()；其他type不put。
3. 回Map，labels資料直接來自非null空map正規化後的FieldRecord，沒有copy.ts或demo欄位名稱判斷。
4. 不加enumValues/helpText/visibility/refTarget/indexed/enabled到public schema。

metadata改名的測試先透過ContentStore.updateFieldMetadata，把public enum x標籤從「舊標籤」改「新標籤」，再GET public types，必須立即看到新標籤。修改工作欄位的其他metadata不應外洩。

## 7. Q-20 pack／一次統計

### 7.1 V11全文與資料保留

services/cms-api/src/main/resources/db/migration/V11__content_type_pack.sql：
~~~sql
-- BW6: generic type metadata; demo values belong to ContentTypeSeed.
ALTER TABLE cms_content_type ADD COLUMN pack TEXT;
~~~
nullable TEXT，契約不設字串長度上限、兩store一致；無default、無demo枚舉CHECK、無UNIQUE、無資料改寫。新庫與舊庫column都從null開始；值的回填由seed完成。不能改V1～V10，也不能建立demo表。V10 Java migration繼承V7而在當時schema讀16-argument ContentTypeRecord；必須保留下面constructor以免歷史migration依賴pack欄位。

### 7.2 ContentTypeRecord完整定義形狀

同package/imports沿用，component最後新增String pack。完整component與相容constructor簽名：
~~~java
public record ContentTypeRecord(
    UUID id, String typeKey, String displayName, String pluralDisplayName,
    String description, String titleField, String slugPolicy, boolean singleton,
    boolean enabled, boolean previewable, List<String> publicRequiresPublishedRefs,
    Instant createdAt, Instant updatedAt, String sortField, String visibilityField,
    String ownerField, String pack) {
    public ContentTypeRecord(UUID id, String typeKey, String displayName, String pluralDisplayName,
        String description, String titleField, String slugPolicy, boolean singleton,
        boolean enabled, boolean previewable, List<String> publicRequiresPublishedRefs,
        Instant createdAt, Instant updatedAt) {
        this(id, typeKey, displayName, pluralDisplayName, description, titleField, slugPolicy,
            singleton, enabled, previewable, publicRequiresPublishedRefs, createdAt, updatedAt,
            null, null, null, null);
    }
    public ContentTypeRecord(UUID id, String typeKey, String displayName, String pluralDisplayName,
        String description, String titleField, String slugPolicy, boolean singleton,
        boolean enabled, boolean previewable, List<String> publicRequiresPublishedRefs,
        Instant createdAt, Instant updatedAt, String sortField, String visibilityField, String ownerField) {
        this(id, typeKey, displayName, pluralDisplayName, description, titleField, slugPolicy,
            singleton, enabled, previewable, publicRequiresPublishedRefs, createdAt, updatedAt,
            sortField, visibilityField, ownerField, null);
    }
    public ContentTypeRecord withEnabled(boolean nextEnabled, Instant now) {
        return new ContentTypeRecord(id, typeKey, displayName, pluralDisplayName, description,
            titleField, slugPolicy, singleton, nextEnabled, previewable, publicRequiresPublishedRefs,
            createdAt, now, sortField, visibilityField, ownerField, pack);
    }
    public ContentTypeRecord withSettings(String nextSort, String nextVisibility, String nextOwner, Instant now) {
        return new ContentTypeRecord(id, typeKey, displayName, pluralDisplayName, description,
            titleField, slugPolicy, singleton, enabled, previewable, publicRequiresPublishedRefs,
            createdAt, now, nextSort, nextVisibility, nextOwner, pack);
    }
    public ContentTypeRecord withPack(String nextPack) {
        return new ContentTypeRecord(id, typeKey, displayName, pluralDisplayName, description,
            titleField, slugPolicy, singleton, enabled, previewable, publicRequiresPublishedRefs,
            createdAt, updatedAt, sortField, visibilityField, ownerField, nextPack);
    }
}
~~~
17-argument只由新的mapper與保留欄位copy使用。所有舊13/16 callers維持，不新增pack預設猜測。必須修改的constructor call sites是record.withEnabled/withSettings、JdbcContentStore.typeMapper、InMemoryContentStore.updateType。ContentTypeSeed/AdminContentController.createType維持13-argument後透過seed的conditional方法設定pack；既有tests和V7/V10 migration callers不改。

### 7.3 store與seed

ContentStore新增 boolean setTypePackIfAbsent(UUID typeId, String pack)。方法是internal seed/storage能力，不新增HTTP pack寫入。候選pack=null直接回false、不寫資料；非null只對存在且pack=null的type寫pack，回true。已非null或unknown type回false；不改updatedAt或其他settings、enabled、fields、index。這是原子conditional write，避免先讀再無條件覆寫。

JdbcContentStore.insertType在原columns最後追加pack，VALUES追加?，binding最後type.pack()。typeMapper最後追加rs.getString("pack")。setTypePackIfAbsent SQL：
~~~sql
UPDATE cms_content_type SET pack = ?
WHERE id = ? AND pack IS NULL;
~~~
綁pack、typeId，affectedRows==1回true。updateType、writeTypeSettings的原SQL不含pack，保持不可經這兩者改pack；InMemory.updateType最後constructor參數用current.pack()。InMemory.setTypePackIfAbsent用types.computeIfPresent逐type檢查id相同、current.pack()==null，才current.withPack(pack)；回傳是否實際更新。以AtomicBoolean收集結果，不把set map先查後put當原子操作。

ContentTypeSeed新增private static final Map<String,String> DEMO_PACKS，使用Map.ofEntries，完整entry為：
~~~text
album=album
photo=album
clinic_profile=clinic
owner=clinic
pet=clinic
vet=clinic
visit=clinic
appointment_request=clinic
project=projects
issue=projects
milestone=projects
~~~
page不入map；自訂type不入map。private type(...)現有簽名不改，在find-or-create type完成後、既有settings/fields流程之前，candidate=DEMO_PACKS.get(key)；candidate!=null呼叫store.setTypePackIfAbsent(type.id(),candidate)。不以withPack+updateType寫回，也不更新非null pack。任何custom非null值（含空字串）保留；不擴張seed管轄至自訂type。原settings seed維持只在三個settings全部null時回填；它的store更新要保存已寫pack。Order100不改，identity finalization可在其後listTypes看到包含appointment_request的完整已登錄類型。seed重啟不重新寫pack、不改內容或updatedAt。

### 7.4 bulk counts與Admin投影

新增content.query.TypeEntryCounts：
~~~java
public record TypeEntryCounts(long entryCount, long publishedCount) {
    public static final TypeEntryCounts ZERO = new TypeEntryCounts(0L, 0L);
}
~~~
ContentStore新增 Map<UUID,TypeEntryCounts> entryCounts(Collection<UUID> typeIds)。typeIds是internal非nullcollection、元素非null。distinct後空集合回Map.of且不發SQL；回應包含每個requested distinct ID，未知或沒有live entries為ZERO。既有countEntries(UUID,boolean)不改。

JdbcContentStore.entryCounts使用LinkedHashSet去重，先建立每ID→ZERO，再一個prepared aggregate覆蓋查到的rows：
~~~sql
SELECT content_type_id,
       COUNT(*) AS entry_count,
       SUM(CASE WHEN publication_state = 'published' THEN 1 ELSE 0 END) AS published_count
FROM cms_entry
WHERE deleted_at IS NULL AND content_type_id IN (?, ...)
GROUP BY content_type_id;
~~~
綁distinct IDs；RowMapper讀UUID/long/long，不查entry payload/index/revisions，不用queryEntries(public)代替。沒有type enabled/public visibility/ACL條件。回Map.copyOf；APItype順序仍來自listTypes。InMemory以同樣distinct ID集合初始化ZERO；從entries.values()的一份快照單次loop跳過deleted，按contentTypeId累加entryCount，publicationState=PUBLISHED才增加publishedCount。查過集合以外的entry不放入map。

ContentProjection新增：
~~~java
static Map<String,Object> adminTypeSchema(ContentTypeRecord type,
    List<FieldRecord> fields, TypeEntryCounts counts)
~~~
先json=typeSchema(type,fields,true)，再put pack/type.pack、entryCount/counts.entryCount、publishedCount/counts.publishedCount，回json。既有typeSchema方法與EntryController的work caller不改，不把治理欄位加到Work/Public schema。

AdminContentController新增private typeJson(ContentTypeRecord,TypeEntryCounts)調adminTypeSchema(type,store.fieldsOf(id),counts)。保留private typeJson(ContentTypeRecord)，它讀store.entryCounts(List.of(type.id())).getOrDefault(id,ZERO)，委派新overload；create/setEnabled回應使用此單筆overload。listTypes授權後先store.listTypes，接著只呼叫一次entryCounts(all type IDs)，每type使用已取得counts，禁止map內逐type呼叫countEntries/queryEntries。現有fieldsOf每type是舊欄位schema讀取；本波要求新增計數沒有N+1，不宣稱整個既有Admin schema流程只剩一次SQL。create結果pack=null/counts0；disabled type的counts仍保留。只讀不新增transaction/audit；write的現有transactions.run和audit不可變更。

## 8. 測試資料、名稱與斷言

所有命令cwd為apps/cms-scaffold。JUnit/MockMvc等待條件是同步perform返回，不使用sleep或browser。store契約每test由既有@BeforeEach newStore重設。API新增MediaListApiTests採@SpringBootTest、@AutoConfigureMockMvc、@DirtiesContext(classMode=AFTER_EACH_TEST_METHOD)，避免seed/live counts在測試之間累積；不把Docker加到test。TestSession.login從注入seed-password取得值；ApiFixture helper沿用，不在文件寫實際密碼。

### 8.1 Q-12（BW6-T05/BW6-T06）

services/cms-api/src/test/java/com/fallrising/cms/AdminInputValidationApiTests.java新增：

| test名稱 | 前置／操作／同步等待 | 明確斷言 |
| --- | --- | --- |
| Q12_fieldKeysMatchApprovedPattern | admin session；每case新type key用ApiFixture.token；POST fields包含a、A、a_0、a加62個k | 201，store field keys按order相同，A/a可並存。 |
| Q12_rejectsUnsafeKeysBeforeAnyWrite | key集合a.b、$slug、_a、1a、emoji，各case body另一欄type=unknown；保存types/fields/type.create audit快照後POST | 422 FIELD_VALIDATION；格式錯在fields[0].key INVALID_FORMAT，type錯仍在列表；快照完全相等。 |
| Q12_lengthAndDuplicateErrorsStayOrdered | fields順序null、空key、64個a、dup、dup、a.b；POST | errors依序fields[0] REQUIRED、[1].key REQUIRED、[2].key TOO_LONG、[4].key DUPLICATE、[5].key INVALID_FORMAT。 |
| Q12_preservesLegacyKeysAndUnicodeText | 直接store建立legacy type＋field a.b＋draft entry payload {"a.b":"unchanged"}；合法新field=63 ASCII、Unicode其他欄位用既有boundary test | legacyfields/payload/revision/ref/index與呼叫前一致；Unicode非key成功案例保留，不將format套到其他文字。 |

現有BQ08_typeBoundariesUnicodeAndEverySupportedFieldTypeAreAccepted只替換emoji key，保留全部支持type與Unicode文字斷言。legacy測試只呼叫新建另一合法type的API，不改legacytype。驗證：
~~~sh
./gradlew test --tests '*AdminInputValidationApiTests' --no-daemon --no-parallel
~~~

### 8.2 Q-14 parser/store（BW6-T07/BW6-T08）

MediaListQueryTests新增下列具名test；在regular test執行：
- Q14_defaultsAndStripsQuery：parse(empty)為(0,24,"")；q="\u2003Sun\u2003"正規化"Sun"；前導0 page接受。
- Q14_rejectsInvalidAndRepeatedParameters：page=-1、+1、" 1"、1.5、empty、2147483648，size=0/101/empty/overflow，各400 VALIDATION_FAILED；page/size/q各兩值同400；q=""合法。
- Q14_offsetUsesLong：new MediaListQuery(Integer.MAX_VALUE,100,"").offset()=214748364700L；constructor负page/invalidsize同400。

MediaStoreContract的fixture方法新增mediaWith(UUID id,String title,String filename,String status,Instant deleted,Instant created)；其餘domain欄位owner=UUID.fromString("00000000-0000-4000-8000-000000000100")、altText=""、contentType=image/png、byteSize100、storedBytes150、width8/height8、checksum "a"×64、updatedAt=created、variants empty。表中ID n用UUID.fromString("00000000-0000-4000-8000-%012d".formatted(n))產生。每asset另insert一thumbnail variant（byteSize10、width8、height8、objectKey="media/"+id+"/thumbnail"），不依賴object bytes。

| test名稱 | 精確fixture／步驟 | 斷言 |
| --- | --- | --- |
| Q14_pagesHaveFilteredTotalAndStableTies | IDs末碼0001–0027，created=T0；title="Sun "+n、filename="f"+n+".png"；另status=deleted且deletedAt=T0的id0028、status available但deletedAt=T0 id0029；query(0,24,"Sun")、(1,24,"Sun") | total27；page0 IDs1–24/page1 IDs25–27；每rowthumbnail存在；排除兩deleted形狀；同created按UUID文字升序。 |
| Q14_queriesTitleOrFilenameLiterally | A(title="Sunrise",filename="a.png")、B(title="Moon",filename="SUN.png")、C(title="100%_\\",filename="c.png")、D(title="other",filename="other.png")；逐query sun、%_\\、blank | sun只A/B；%_\\只C；blank全available，不把%/_當wildcards；title/filename兩者命中同asset只出現一次。 |
| Q14_emptyAndBeyondLastPageKeepTotal | 上述27row；query(2,24,"Sun")、(Integer.MAX_VALUE,100,"Sun")、(0,24,"absent") | 前兩items空total27且pageecho；最後total0/items空；offset無overflow。 |
| Q14_newestBeforeTextTieBreak | old id0001 createdT0、new id0003 createdT0+1s、new id0002 same+1s | IDs2、3、1。配額countFiles仍含deleted；舊B08_countsAndSumsIncludeDeleted保留。 |

驗證：
~~~sh
./gradlew test --tests '*MediaListQueryTests' --tests '*InMemoryMediaStoreContractTests' --no-daemon --no-parallel
./gradlew integrationTest --tests '*JdbcMediaStoreContractTests' --no-daemon --no-parallel
~~~

### 8.3 Q-14 API／SQL數／故障（BW6-T09/BW6-T10）

| 檔案與test名稱 | fixture／動作／等待 | 斷言 |
| --- | --- | --- |
| MediaListApiTests.Q14_listDefaultsAndEchoesPage | BACK operator-album與ADMIN admin；使用§8.2的27available、2deleted，title/filename加每test唯一token；GET ?q=token，以及?page=1&size=24&q=token | 200；defaults page0/size24/total27；第二頁3rows；所有deletedAt=null；未知q返回200空total0。 |
| MediaListApiTests.Q14_invalidQueryAndDeniedSurface | validBACK session GET page=-1/repeatq/size101；匿名GET同bad query；FRONT登入GET；BACK無manage_media sessionGET | validBACK400；匿名401先於parser；FRONT403 SURFACE_FORBIDDEN；無action403 FORBIDDEN。error envelope經現有OpenAPIvalidator。 |
| MediaErrorCodeApiTests.Q14_deletedMetadataRemainsReadable | 延用png() multipart upload並DELETE後GET by-id/private original/public metadata/public original | authorized metadata200且deletedAt為date-time非null；private410 MEDIA_GONE；public兩者404 MEDIA_NOT_FOUND；不存在id404。 |
| MediaErrorCodeApiTests.Q14_uploadAndPublicProjectionHaveNullDeletion | 以本class既有png() upload取得id，store.find(id)取得asset；新增@Autowired MediaService，呼叫media.json(asset,true) | upload201與public projection含deletedAt:null；public投影無owner/checksum/objectKey。既有MediaApiTests的真實attach/publish公開HTTP流程仍經OpenAPIvalidator驗證新增required欄。 |
| MediaListServiceTests.Q14_authorizationPrecedesParsingAndStore | Mockito AuthorizationService.require丟FORBIDDEN；params page=-1；mock MediaStore | FORBIDDEN先發生，queryMedia不被呼叫；有action但badquery400亦不查store。 |
| MediaListServiceTests.Q14_storeFailureUsesExistingEnvelope | standalone MockMvc MediaController＋ApiExceptionHandler；mock MediaService.list丟DataAccessResourceFailureException；request已注入BACK identity（參照TypeSchemaTests identity request） | 500 INTERNAL_ERROR，不洩漏SQL/DBexception message；沒有items success。 |
| MediaBatchQueryCountTests.Q14_listUsesThreeQueriesIndependentOfPageSize | PostgresFixture.cleanDataSource；既有counting(DataSource)；直接insert27available＋thumbnail；statements.set(0)後query size1與24 | 每次正好3 statements；pageitems正確且variants已hydrated；beyond-last／unknownq=2 statements；不破壞既有findAll two-query測試。 |
| MediaListServiceTests.Q14_metadataDoesNotReadLibrary | mock store.find(id)回deleteddomain、authorization允許；new MediaService(store,mockObjects,mockContent,authorization)及MediaController；注入BACK identity後controller.get、verify | metadata Map含id與deletedAt；從未queryMedia/listAvailable，不以list掃描作auth。HTTP200另由Q14_deletedMetadataRemainsReadable驗證。 |

500 test不啟動DB；state reads同步，不需要browser fault。既有MediaBatchTests安全參數矩陣、PublicMediaCountTests保持，特別包含draft/private/unlisted/disabled type/required ref/工作變更不取代published attachment。

驗證：
~~~sh
./gradlew test --tests '*MediaListApiTests' --tests '*MediaErrorCodeApiTests' --tests '*MediaListServiceTests' --tests '*MediaApiTests' --tests '*MediaBatchTests' --no-daemon --no-parallel
./gradlew integrationTest --tests '*MediaBatchQueryCountTests' --no-daemon --no-parallel
~~~

### 8.4 Q-17（BW6-T11/BW6-T12）

TypeSchemaTests用ContentStore直接insert獨立probe type，type key "public_label_probe"；取得既有匿名READ_PUBLISHED grant對此probe的允許：Mockito AuthorizationService.hasAction返回true，建PublicContentController(null,store,null,null,authorization)；types request未登入（principal=null），不靠新增全域角色。另以已有vet的HTTP endpoint覆蓋真實匿名permission。

probe fields的共同欄位required=false/indexed=false/sortOrder依表序、enumValues=["x"]、publicBytes=false：
~~~text
visible: enum, public, enabled=true, enumLabels={x:舊標籤}
empty: enum, public, enabled=true, enumLabels={}
title: string, public, enabled=true, enumLabels={x:不可公開}
staff: enum, back, enabled=true, enumLabels={x:工作秘密}
secret: enum, internal, enabled=true, enumLabels={x:內部秘密}
gone: enum, public, enabled=false, enumLabels={x:已停用}
~~~
- Q17_onlyPublicEnabledEnumLabelsAreProjected：types結果只有visible/empty/title；visible labels={x:舊標籤}、empty={}，title沒有enumLabels；JSON不含另外三field名稱或其labels，沒有WorkField其他keys。
- Q17_metadataChangesAreReflected：updateFieldMetadata(visible.withMetadata(...,{x:新標籤},...))後types，visible新標籤立即可見。
- Q17_anonymousAndFrontUseExistingTypeVisibility：匿名GET public/content-types含vet.specialty種子labels；FRONT seed-admin同結果不額外含internal fields；直接probe disabled type的controller filter排除type。

不修改Back G06_enumLabelsAreExposed與Back/internal/admin差異case。驗證：
~~~sh
./gradlew test --tests '*TypeSchemaTests' --no-daemon --no-parallel
~~~

### 8.5 Q-20 pack／migration（BW6-T01/BW6-T02）

| test位置／名稱 | 前置／步驟 | 斷言 |
| --- | --- | --- |
| ContentStoreContract.Q20_packRoundTripsAndCopiesPreserveIt | canonical17 type pack="custom_pack"及另一type pack="p"重複128次；insert、find、withEnabled(false)、withSettings("rank","visibility","owner",T0)；updateType/updateTypeSettings傳incoming不同pack | find/list逐字保存兩種pack（含128字元）；copy methods保存；generic updates不能覆寫current pack，其他原契約斷言保留。 |
| ContentStoreContract.Q20_packBackfillOnlyChangesNullPack | type A pack=null、B pack="custom_pack"、unknown UUID；set A "clinic"兩次、B "clinic"、unknown "clinic"、A null | 首次true其餘false；只有A.pack變；updatedAt/settings/fields/index不變；兩種store同結果。 |
| ContentTypeSeedTests.Q20_seedAssignsOnlyRegisteredDemoPacks | fresh InMemory store.seed兩次；另insert custom_type pack=null | §7.3十一種mapping完整；page/custom null；第二次types完整快照不變。 |
| ContentTypeSeedTests.Q20_seedPreservesCustomMetadataAndNonNullPack | 先insert已有album pack="custom_pack"、clinic_profile pack=null且自訂settings/enabled=false、page pack="shared_custom" | seed後album/page自訂pack保留；clinic只填clinic，其settings/enabled/updatedAt保留；field metadata舊保存case仍通過。 |
| TypePackMigrationTests.Q20_v11AddsNullablePackWithoutRewritingContent | PostgresFixture.emptyDataSource；Flyway target("10") migrate；insert legacytype、fieldkey a.b、draft與published entry、revision/ref/index；保存payload/revision/ref/index快照；migrate latest到V11 | column pack存在且nullable，舊type.pack=null；schema history含成功V10/V11；所有內容快照相等；newseed後mapped type才有pack。 |

migration test使用JdbcTemplate在V10 schema插入前置資料，不在V11前構造需要讀pack的新JdbcContentStore。沒有CHECK/UNIQUE新增，所以只測null與非null持久保存；不捏造enum反例。新的genericpack值不由API供用戶寫入。

Q20_v11AddsNullablePackWithoutRewritingContent的前置SQL全文如下，UUID與timestamp固定於此獨立schema，不使用seed account或外部資料。migrate到10後依序執行，latest migration前後分別SELECT並比較下面插入的全部row內容，僅cms_content_type增加的pack欄可以是null：
~~~sql
INSERT INTO cms_content_type
  (id,type_key,display_name,plural_display_name,title_field)
VALUES ('00000000-0000-4000-8000-000000000201','legacy_probe','Legacy','Legacy entries','a.b');
INSERT INTO cms_field
  (id,content_type_id,field_key,field_type,indexed)
VALUES ('00000000-0000-4000-8000-000000000202',
        '00000000-0000-4000-8000-000000000201','a.b','string',true);
INSERT INTO cms_entry
  (id,content_type_id,slug,publication_state,payload,published_payload,published_at)
VALUES ('00000000-0000-4000-8000-000000000203',
        '00000000-0000-4000-8000-000000000201','draft','draft','{"a.b":"working"}',NULL,NULL),
       ('00000000-0000-4000-8000-000000000204',
        '00000000-0000-4000-8000-000000000201','published','published',
        '{"a.b":"new work"}','{"a.b":"published snapshot"}','2026-01-01T00:00:00Z');
INSERT INTO cms_entry_revision
  (id,entry_id,revision_no,payload,published_at,content_type_key)
VALUES ('00000000-0000-4000-8000-000000000205',
        '00000000-0000-4000-8000-000000000204',1,
        '{"a.b":"published snapshot"}','2026-01-01T00:00:00Z','legacy_probe');
INSERT INTO cms_entry_ref (from_entry_id,field_key,to_id,to_kind,sort_position)
VALUES ('00000000-0000-4000-8000-000000000204','legacy_ref',
        '00000000-0000-4000-8000-000000000203','entry',0);
INSERT INTO cms_entry_index (entry_id,field_key,value_kind,value_string,scope)
VALUES ('00000000-0000-4000-8000-000000000204','a.b','string','new work','work'),
       ('00000000-0000-4000-8000-000000000204','a.b','string','published snapshot','published');
~~~
快照用SELECT * FROM cms_field ORDER BY id、cms_entry ORDER BY id、cms_entry_revision ORDER BY id、cms_entry_ref ORDER BY from_entry_id,field_key、cms_entry_index ORDER BY entry_id,scope,field_key；cms_content_type只比較migration前既有欄位投影，另斷言pack=null。jsonb比較解析後JSON，不依賴字串key順序。Flyway歷史查version IN ('10','11')且success=true。新seed回填另由ContentTypeSeedTests覆蓋；此legacy_probe不是demo mapping，seed後pack仍null。

驗證：
~~~sh
./gradlew test --tests '*InMemoryContentStoreContractTests' --tests '*ContentTypeSeedTests' --no-daemon --no-parallel
./gradlew integrationTest --tests '*JdbcContentStoreContractTests' --tests '*TypePackMigrationTests' --no-daemon --no-parallel
~~~

### 8.6 Q-20 counters/Admin（BW6-T03/BW6-T04）

ContentStoreContract fixture：A enabled、pack="album"；B disabled、pack="custom_pack"；C empty。A entries為draft1、published public2、published private3、published unlisted4、archived5、deleted draft6、deleted published7；各entry使用既有entry(type,slug,state,payload,time) helper，published payload含visibility值、work copy相同；deleted用既有deleted(entry,T0+1)。B只有published8。scope不套publicvisibility。

- Q20_countsIncludeAllLiveStatesAndAllPublishedVisibility：entryCounts([A,B,C,A,unknown])結果A=(5,3)、B=(1,1)、C/unknown=(0,0)、只有A/B/C/unknown四個distinct keys；emptycollection空map。publishedCount≤entryCount，deleted兩者不含。
- Q20_countsTrackTransitionsAndSoftDeletion：A的draft1用既有updateEntry與version+1改published，counts(5,4)；再soft-delete該entry，counts(4,3)；hard-delete原deleted7不改livecounts。不用publicList total替代。
- TypeEntryCountsQueryCountTests.Q20_countsUseOneSqlForOneAndTwelveTypes：使用PostgresFixture＋DataSource dynamic proxy計prepareStatement（沿用MediaBatchQueryCountTests counting實作，放此新class private method）；12type各含draft＋published，重設counter後請求1/12type都正好1 SQL，全部值(2,1)；empty請求0 SQL。
- TypeSchemaTests.Q20_adminResponsesHavePackAndLiveCounts：用已有admin HTTP session GET list，另create customtype→(null,0,0)，enable/disable該customtype→同三欄；直接controller mockstore的listTypes=兩type、entryCounts map明值，verify entryCounts一次且typeJson沒有countEntries/queryEntries；既有公開/工作type不含三欄。
- TypeSchemaTests.Q20_countsFailureDoesNotBecomeSuccess：Mockito store.entryCounts丟DataAccessResourceFailureException，standaloneAdminController＋ApiExceptionHandler＋已授權ADMIN request；500 INTERNAL_ERROR，沒有items/0假成功。未授權類型管理仍403。

驗證：
~~~sh
./gradlew test --tests '*InMemoryContentStoreContractTests' --tests '*TypeSchemaTests' --no-daemon --no-parallel
./gradlew integrationTest --tests '*JdbcContentStoreContractTests' --tests '*TypeEntryCountsQueryCountTests' --no-daemon --no-parallel
~~~

## 9. 十二張測試先行任務卡

Red卡遇到新Java符號尚不存在時，先建立本節明列的compile-only接口／record scaffold，既有store的新方法暫用default throw new UnsupportedOperationException("BW6 not implemented")，parser parse暫同樣throw。它們只使測試編譯，Red要記錄具名case的行為assertion或尚未實作operation失敗，不能把無關編譯錯誤當Red證據。配對Green卡必須移除全部scaffold throw，run focused tests轉綠。新component使歷史constructors仍可編譯；17-component/pure-copy結構不計作store功能完成。

每張卡只碰§2對應檔案。下列行數是新增/修改行估算，含test scaffolding；不是宣稱已實測diff。每卡≤400，不用合併卡掩蓋規模。

### BW6-T01 pack保存／migration Red

- **目標**：generic pack與新舊資料保留先有store/seed/migration測試。
- **輸入**：§7.1～7.3/§8.5，ContentStoreContract、ContentTypeSeedTests、PostgresFixture。
- **步驟**：1加17-component與13/16 constructor bridge以保留舊callers，withPack可先compile-only；2新增setTypePackIfAbsent default throw；3新增§8.5五具名case與TypePackMigrationTests；4保存pack conditional/seed mapping與V11 column missing的行為失敗，確認V7/V10仍可執行。
- **完成條件**：每種store、new/old/custom seed與V10upgrade都有case，不先改DDL使migrationRed消失。
- **驗證**：`./gradlew test --tests '*InMemoryContentStoreContractTests' --tests '*ContentTypeSeedTests' --no-daemon --no-parallel`；`./gradlew integrationTest --tests '*JdbcContentStoreContractTests' --tests '*TypePackMigrationTests' --no-daemon --no-parallel`。
- **對應 ID**：Q-20。
- **預估大小**：M（估360行；上限400行）。

### BW6-T02 pack保存／migration Green

- **目標**：通用column與seed回填保持客製資料。
- **輸入**：BW6-T01。
- **步驟**：1新增V11全文；2完成record三copy methods；3JDBC insert/mapper與memory updateType保存pack；4兩store atomic conditional寫；5seed-only十一項mapping與Order100保持；6移除scaffold，§8.5轉綠。
- **完成條件**：非nullpack/legacy key/payload/revision/ref/index/updatedAt保存，historyV10/V11成功；seed重跑不改值。
- **驗證**：`./gradlew test --tests '*InMemoryContentStoreContractTests' --tests '*ContentTypeSeedTests' --no-daemon --no-parallel`；`./gradlew integrationTest --tests '*JdbcContentStoreContractTests' --tests '*TypePackMigrationTests' --no-daemon --no-parallel`。
- **對應 ID**：Q-20。
- **預估大小**：M（估210行；上限400行）。

### BW6-T03 bulk counters／Admin Red

- **目標**：治理counts不使用public total、不逐type查詢。
- **輸入**：BW6-T02、§7.4/§8.6。
- **步驟**：1新增TypeEntryCounts宣告與entryCounts default throw；2新增兩ContentStoreContract tests；3TypeSchemaTests新增counts/error/response case；4新增TypeEntryCountsQueryCountTests；5§8.6記錄缺counts或未實作aggregate的行為失敗。
- **完成條件**：0entry、disabled、private/unlisted、deleted、transitions與固定SQL數均有assertion。
- **驗證**：`./gradlew test --tests '*InMemoryContentStoreContractTests' --tests '*TypeSchemaTests' --no-daemon --no-parallel`；`./gradlew integrationTest --tests '*JdbcContentStoreContractTests' --tests '*TypeEntryCountsQueryCountTests' --no-daemon --no-parallel`。
- **對應 ID**：Q-20。
- **預估大小**：M（估350行；上限400行）。

### BW6-T04 bulk counters／Admin Green

- **目標**：一次aggregate回所有requested types並維持所有Admin回應完整。
- **輸入**：BW6-T03。
- **步驟**：1實作兩store的singlebulk counts；2adminTypeSchema只加三治理欄；3AdminController list一次取得map，create/enable/disable取單ID同projection；4runtime openapi.yaml AdminContentType新增required pack(nullable string)、entryCount/publishedCount(integer int64 minimum0)；5移除scaffold；6§8.6轉綠。此卡在BW6-T06完整AdminInputValidationApiTests Green前完成。
- **完成條件**：§8.6綠、工作/公開schema不增治理欄位、500不回假0。
- **驗證**：`./gradlew test --tests '*InMemoryContentStoreContractTests' --tests '*TypeSchemaTests' --no-daemon --no-parallel`；`./gradlew integrationTest --tests '*JdbcContentStoreContractTests' --tests '*TypeEntryCountsQueryCountTests' --no-daemon --no-parallel`。
- **對應 ID**：Q-20。
- **預估大小**：M（估200行；上限400行）。

### BW6-T05 Q12拒絕案例

- **目標**：先證明不安全field key可被舊API接受的缺口。
- **輸入**：基準AdminInputValidationApiTests，§4/§8.1。
- **步驟**：1新增四具名case；2只替換舊emoji-key成功fixture而保留其他Unicodecase；3執行§8.1命令，保存Q12_rejectsUnsafeKeysBeforeAnyWrite的422 expectation失敗。
- **完成條件**：目標case在舊實作失敗，其他既有驗證case未被刪除。
- **驗證**：`./gradlew test --tests '*AdminInputValidationApiTests' --no-daemon --no-parallel`。
- **對應 ID**：Q-12。
- **預估大小**：S（估120行；上限150行）。

### BW6-T06 Q12 regex

- **目標**：完整收集fields[i].key格式錯誤。
- **輸入**：BW6-T05與BW6-T04已完成。counts/Admin Green須先完成，避免完整class中的新建type成功回應缺少required pack/counts。
- **步驟**：1按§4在length後、duplicate前加regex分支；2保持其他驗證與write boundary；3runtime openapi.yaml的CreateFieldRequest.key加入pattern；4focused命令轉綠，不在此卡改生成檔。
- **完成條件**：§8.1全綠且legacy資料快照不變。
- **驗證**：`./gradlew test --tests '*AdminInputValidationApiTests' --no-daemon --no-parallel`。
- **對應 ID**：Q-12。
- **預估大小**：S（估30行；上限150行）。

### BW6-T07 Media query/store Red

- **目標**：兩種store的filtered total與stable paging先有失敗契約。
- **輸入**：§5與§8.2，現有MediaStoreContract/兩runner。
- **步驟**：1新增MediaListQuery、MediaPage宣告與parse scaffold、新queryMedia default scaffold；2新增parser與四store case；3分別執行§8.2兩命令，記錄未實作queryMedia/parse造成指定case失敗，不以編譯失敗代替。
- **完成條件**：parser default/strip與storepages失敗證據可辨认；舊listAvailable/配額契約仍可跑。
- **驗證**：`./gradlew test --tests '*MediaListQueryTests' --tests '*InMemoryMediaStoreContractTests' --no-daemon --no-parallel`；`./gradlew integrationTest --tests '*JdbcMediaStoreContractTests' --no-daemon --no-parallel`。
- **對應 ID**：Q-14。
- **預估大小**：M（估310行；上限400行）。

### BW6-T08 Media query/store Green

- **目標**：SQL與memory有同一分頁／搜尋行為。
- **輸入**：BW6-T07。
- **步驟**：1新增MediaException.invalidParameter；2完成parser固定分支；3兩store實作§5 count/page/hydration；4移除interface/scaffold throw；5focused轉綠，review不逐asset查variants。
- **完成條件**：§8.2全部綠，沒有unknown token、page overflow或wildcard擴張。
- **驗證**：`./gradlew test --tests '*MediaListQueryTests' --tests '*InMemoryMediaStoreContractTests' --no-daemon --no-parallel`；`./gradlew integrationTest --tests '*JdbcMediaStoreContractTests' --no-daemon --no-parallel`。
- **對應 ID**：Q-14。
- **預估大小**：M（估270行；上限400行）。

### BW6-T09 Media API與SQL上限 Red

- **目標**：先揭示API仍回items-only與metadata缺deletedAt。
- **輸入**：BW6-T08、§8.3、既有query-count counting helper。
- **步驟**：1新增MediaListApiTests/MediaListServiceTests；2在MediaErrorCodeApiTests擴充具名metadata/null案例；3在MediaBatchQueryCountTests加入pageSQL數；4用§8.3命令保存missing total/page/deletedAt的assertion failure。新service signatures如需編譯，先只加同名throw scaffold。
- **完成條件**：授權、400、nullable與SQL數每一項都有指定test，而非只happy path。
- **驗證**：`./gradlew test --tests '*MediaListApiTests' --tests '*MediaErrorCodeApiTests' --tests '*MediaListServiceTests' --tests '*MediaApiTests' --tests '*MediaBatchTests' --no-daemon --no-parallel`；`./gradlew integrationTest --tests '*MediaBatchQueryCountTests' --no-daemon --no-parallel`。
- **對應 ID**：Q-14。
- **預估大小**：M（估330行；上限400行）。

### BW6-T10 Media API／DTO Green

- **目標**：authorized page與deleted metadata正確投影。
- **輸入**：BW6-T09。
- **步驟**：1MediaService新增requireManage與三參數list；2MediaController list/get依§5接線；3json加nullable deletedAt，public固定null；4runtime openapi.yaml同步MediaAsset.required deletedAt及nullable date-time、MediaAssetPage schema、listMedia page/size/q參數與400 Error400回應；5刪舊list二參數與所有scaffold throw；6focused轉綠，不改bytes/public判斷。
- **完成條件**：§8.3綠、metadata不掃library、private410/public404保留。
- **驗證**：`./gradlew test --tests '*MediaListApiTests' --tests '*MediaErrorCodeApiTests' --tests '*MediaListServiceTests' --tests '*MediaApiTests' --tests '*MediaBatchTests' --no-daemon --no-parallel`；`./gradlew integrationTest --tests '*MediaBatchQueryCountTests' --no-daemon --no-parallel`。
- **對應 ID**：Q-14。
- **預估大小**：S（估115行；上限150行）。

### BW6-T11 Public enum Red

- **目標**：公開labels與visibility閘門先有失敗case。
- **輸入**：§6/§8.4與TypeSchemaTests。
- **步驟**：1建立完整六field fixture；2新增三具名test；3執行§8.4，visible labels assertion在舊投影失敗。
- **完成條件**：nonenum省略與back/internal/disabled排除的assertions存在。
- **驗證**：`./gradlew test --tests '*TypeSchemaTests' --no-daemon --no-parallel`。
- **對應 ID**：Q-17。
- **預估大小**：S（估140行；上限150行）。

### BW6-T12 Public enum Green

- **目標**：只公開合格enum labels。
- **輸入**：BW6-T11。
- **步驟**：1publicType保持filters；2新增publicField投影如§6；3runtime openapi.yaml PublicField新增optional enumLabels object、additionalProperties string，不改required三欄；4§8.4轉綠，不重用WorkField投影。
- **完成條件**：labels改名即讀新值，非public/disabled沒有metadata洩漏。
- **驗證**：`./gradlew test --tests '*TypeSchemaTests' --no-daemon --no-parallel`。
- **對應 ID**：Q-17。
- **預估大小**：S（估25行；上限150行）。

本附錄卡數12：S5／M7，估總2460新增/修改行；卡上限360。主施工圖另有identity/governance與shared integration卡，總卡數由root統計，不能只用本文12宣稱整波≤30。

主施工圖採BW6-T01→BW6-T12次序：先pack與counts，再新建key、媒體與公開labels；每組Red先於自己的Green。runtime schema只同步該Green已實作範圍；主施工圖依相同dependency排全波卡，不把全BW6尚未實作欄位一次加required而使中途focused回應validator無法轉綠。

## 10. 失敗模式對照

| FM | 情境與期望 | named test／卡 |
| --- | --- | --- |
| BW6-FM01 | key非法422 FIELD_VALIDATION、fields[i].key INVALID_FORMAT，無type/field/audit部分寫入 | Q12_rejectsUnsafeKeysBeforeAnyWrite；BW6-T05/BW6-T06 |
| BW6-FM02 | Unicode文字邊界、長度、duplicate及legacykey不可錯誤改寫 | Q12_lengthAndDuplicateErrorsStayOrdered、Q12_preservesLegacyKeysAndUnicodeText；BW6-T05/BW6-T06 |
| BW6-FM03 | page/size/q格式、重複或overflow400 VALIDATION_FAILED；size預設24/page0 | Q14_rejectsInvalidAndRepeatedParameters、Q14_invalidQueryAndDeniedSurface；BW6-T07～BW6-T10 |
| BW6-FM04 | filtered total錯誤、最後頁或巨大page、同時間戳順序飄動 | Q14_pagesHaveFilteredTotalAndStableTies、Q14_emptyAndBeyondLastPageKeepTotal、Q14_newestBeforeTextTieBreak；BW6-T07/BW6-T08 |
| BW6-FM05 | q中的%/_/backslash成wildcard，或只title漏原檔名 | Q14_queriesTitleOrFilenameLiterally；BW6-T07/BW6-T08 |
| BW6-FM06 | 匿名／FRONT／無MANAGE_MEDIA不能看庫或total；授權先於queryvalidation/store | Q14_invalidQueryAndDeniedSurface、Q14_authorizationPrecedesParsingAndStore；BW6-T09/BW6-T10 |
| BW6-FM07 | 已刪private metadata錯誤410、公開洩漏deleted、upload缺nullable欄 | Q14_deletedMetadataRemainsReadable、Q14_uploadAndPublicProjectionHaveNullDeletion；BW6-T09/BW6-T10 |
| BW6-FM08 | DB失敗500 INTERNAL_ERROR不能回空成功；page逐列variants N+1 | Q14_storeFailureUsesExistingEnvelope、Q14_listUsesThreeQueriesIndependentOfPageSize；BW6-T09/BW6-T10 |
| BW6-FM09 | public nonenum/back/internal/disabled labels外洩，或metadata改名不反映 | Q17_onlyPublicEnabledEnumLabelsAreProjected、Q17_metadataChangesAreReflected；BW6-T11/BW6-T12 |
| BW6-FM10 | V11占用V10、舊資料被改寫、歷史constructor不相容 | Q20_v11AddsNullablePackWithoutRewritingContent；BW6-T01/BW6-T02 |
| BW6-FM11 | seed覆蓋nonnull客製pack/settings，generic updates清掉pack | Q20_seedPreservesCustomMetadataAndNonNullPack、Q20_packRoundTripsAndCopiesPreserveIt；BW6-T01/BW6-T02 |
| BW6-FM12 | deleted被算入、private/unlisted漏計、disabled/0entry漏列、逐typecount | Q20_countsIncludeAllLiveStatesAndAllPublishedVisibility、Q20_countsUseOneSqlForOneAndTwelveTypes；BW6-T03/BW6-T04 |
| BW6-FM13 | create/enable/disable無三欄、資料庫失敗回0假成功 | Q20_adminResponsesHavePackAndLiveCounts、Q20_countsFailureDoesNotBecomeSuccess；BW6-T03/BW6-T04 |

版本衝突不是新增Media/Public-schema讀取行為，沒有新version request。Q12失敗寫入的無部分副作用與既有P0/BW2 optimistic conflict tests保留；本波不另發明Media version錯誤。write resource不存在沿用CONTENT_TYPE_NOT_FOUND或MEDIA_NOT_FOUND。既有CSRF/session與surface matrix全閘門仍跑；本附錄的API tests補與本次新分支直接相關的拒絕情境。

## 11. 整合與交付檢查

- [ ] 12卡具名test先Red後Green，runtime無compile-only stub。
- [ ] V11新增，V1～V10 hash不改；ContentTypeRecord13/16callers可編譯。
- [ ] shared BW6整檔OpenAPI與本文參數/schema/error一致；codegen與typed fixtures同步。
- [ ] private metadata200/file410/public404、public enum可見性、custom pack保留有API/store證據。
- [ ] media SQL為非空3/空2、counts一次aggregate，測量不包含fixture inserts。
- [ ] 根共享卡的mediaPage與0-base legacy mediaList adapter通過25+媒體的舊Back/picker tests，不提前做W6畫面。
- [ ] 主施工圖完整閘門、links/source checks、獨立審查與evidence gate通過後由root更新DOC_READY；本附錄沒有宣稱已跑產品測試。
