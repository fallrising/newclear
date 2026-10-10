# BW6 細化開工盤點與 BQ-14

日期：2026-10-06。狀態：**BQ-14 B 已批准／保留決策盤點歷史；施工圖與 DOC_READY 以 [BW6](waves/BW6.md) 及其合併狀態為準**。
基準：W5 [PR #300](https://github.com/fallrising/newclear/pull/300) 合併 `147f3cde4a5dad653a46ebc0dbfa89fd8ccefefb`。本輪只處理 [BW6](02-backend-sdd.md#7-後端波次)，W6 畫面另立波次。

## 已批准的八題與現況

| 題目 | 本輪已核對的現況 | 細化約束 |
| --- | --- | --- |
| Q-12 | `AdminContentController.FieldBody` 尚未以 regex 驗證 key；BW5 有接受 emoji key 的舊 API 測試。 | 依最新 owner A：新建 key 使用 `^[A-Za-z][A-Za-z0-9_]{0,62}$`；保留其他文字欄位的 Unicode code point 長度測試，不自動改寫既有欄位／entry。 |
| Q-14 | `GET /media` 只有 items，`listAvailable()` 排除 deleted；私有 metadata 可回 deleted asset 的 200，私有 bytes 才是 410；JSON 沒有 deletedAt。 | 新增 server page/size/q 與 nullable deletedAt；filtered total 不能使用包含 deleted 的 quota countFiles。既有私有 metadata 與公開 bytes 的安全邊界要逐一保留。搜尋 title 與 originalFilename 的不分大小寫包含；回收列表與缺失引用的顯示規則必須在施工圖列明，不開公開回收庫。 |
| Q-17 | 公開欄位投影沒有 enumLabels，工作欄位已有。 | 只輸出 visibility=public 的 enum labels；不得洩漏 Back/internal 欄位或 labels。Front 移除自帶標籤由 W6 執行。 |
| Q-20 | ContentTypeRecord／持久層沒有 pack；現有 countEntries 沒有一次取得全類型的 live/published counts。 | pack 資料由 demo seed 寫入通用 nullable metadata，kernel 不寫死 demo 類型名；計數不含 soft-deleted entries、不由前端猜算，具體 migration／SQL 在施工圖定案。defaultVisibility／surfaces 仍是另案。 |
| Q-23 | Principal domain 與 cms_principal 已有 lastLoginAt，成功登入會更新；API 投影未輸出 roles／lastLoginAt。 | roles 用既有 role assignments；role filter 不修改權限；總覽的角色顯示不取代後端 countUsableAdmins 的安全判定。 |
| Q-24 | email 空字串目前原樣保存，會參與 unique-email 檢查。 | PATCH 的缺省／null 保持不變，空字串先轉 null 再驗證／儲存；不更動建立帳號的其他欄位語義。 |
| Q-25 | 只有 entry purge 已有硬刪 API；SELF guard 未實作，治理缺權限的 denied audit 與業務拒絕是不同路徑。 | 確認欄位只套用既有 `POST /admin/entries/{id}/purge`；不新增 Q-22=B 排除的 media hard delete。SELF_* 的 403 依較新 A，非 self 的 LAST_ADMIN 既有 guard 保留；拒絕不能改資料，denied audit 要在 rollback 外保存。 |
| Q-26 | operator 通配 grants 與類型 allowlist 相交；加入 appointment_request 會同時得到 create／publish／unpublish／delete／archive。 | 不能直接擴 allowlist 後宣稱達到 read_draft/update、不 publish；BQ-14 必須先決定，不能用 UI 隱藏發布替代 API 拒絕。 |

已批准規則依 01 §13 的最新 owner 決定；Q-12 的最新明定 regex、Q-25 的 403 直接按批准 A 細化，不把較早規格文字差異當成重新批准的理由。本檔保留開工盤點；完整檔案、方法、SQL、task、測試與FM已整理於BW6施工圖，本盤點不取代施工圖。

## BQ-14：Q-26 的授權粒度衝突

已批准 [01 Q-26](01-frontend-sdd.md#138-整合複查時新增已決定owner2026-10-03) 要求 clinic operator 能讀／更新預約申請，不給 publish。現有 RBAC 沒有每個 role assignment 的每類型 action 上限。

### 可重查的證據

均以本輪基準 source 為準（行號會隨後續修訂移動）：

- `services/cms-api/src/main/java/com/fallrising/cms/identity/service/SeedService.java:81`：clinic operator 只有一個 OPERATOR assignment，allowlist 五個 clinic 類型。
- 同檔 `:117–133`：EDITOR 有 wildcard create，OPERATOR 有 wildcard create/publish/unpublish/delete/archive；新增兩條精確 read/update grant 不會抵消既有 wildcard。
- `services/cms-api/src/main/java/com/fallrising/cms/identity/service/AuthorizationService.java:80–87,179–191`：任一 grant 允許即成功，operator/editor 只按 allowlist 與 grant type 相交，沒有 deny 或 action cap。
- 同檔 `:107–126,143–160`：listAccess 與 capabilities 使用同一 grant matcher，不能只修按鈕或單筆 publish 而讓能力查詢說謊。
- `services/cms-api/src/main/java/com/fallrising/cms/identity/domain/PrincipalRoleAssignment.java:6`：只有 principalId/roleId/roleCode/contentTypeCodes。
- [01 Q-21](01-frontend-sdd.md#137-w4-細化時新增已決定owner2026-10-03) 選 B，v2 只使用五個系統角色；不能自行增第六個 clinic_request_operator 角色。

### 決定紀錄

Owner 於 2026-10-06 回覆「好，按你建議」，批准 **B** 的完整政策：現有模型逐類型 grants、只有完整舊標準 grants 與標準 clinic assignments 自動升級、保留客製資料並回報未套用、新類型須明確授權。A／C 保留為歷史選項；不再等待 BQ-14 批准。施工圖須完成審查與合併後才是 DOC_READY。

### 三個選項（歷史提案，已選 B）

**A：新增通用的 assignment 每類型 action 上限。**

- 保留五個角色、既有 grants 與加性 RBAC，不寫 clinic 專用授權判斷。
- 候選欄位 `actionLimits: { "<contentType>": ["<type action>"] }` 放在 role assignment；某類型沒有 key 時沿用既有權限，有 key 時只限制該 assignment 對該類型的 action，不能新增角色原本沒有的權限；global actions 不受 type 上限影響。
- clinic seed 的 OPERATOR allowlist 加入 appointment_request，僅該類型上限為 `["read_draft", "update"]`。其他 assignment／角色仍依聯集運作，不把此欄位變成全 principal deny。
- 舊資料沒有上限，保持既有行為；需向前 migration 存 nullable JSONB、domain/store/API/OpenAPI／驗證／matcher／capabilities／effective permissions 的一致變更與兩種 store 回歸。
- 舊版 W4 的角色 PUT 不會傳新欄位：同一個保留的 assignment 省略 actionLimits 時須保留既有上限；不可讓日常儲存角色意外解除 seed 的限制。明確解除上限的契約與 Admin W6 消費要在施工圖列明。
- 這是超過原 Q-26 種子範圍的通用能力增量；owner 批准後才擴充 BW6 範圍與拆卡，若超過 30 卡再依細化規範提拆波，不先寫程式。

**B（建議）：只使用現有模型，將 operator 的通配型別 grants 改成明列各類型。**

- appointment_request 只列 read_draft/update；其他已登錄類型保留原有 action，global manage_media 保留。
- 不新增角色／matcher 原語，但改變所有 operator 對後續自訂類型的預設：新增 type 與 allowlist 後還需新增該 type 的 grants。
- 新建標準 demo 種子以已登錄類型建立上述明列 grants；既有標準 operator grants 升級時，先正規化比對舊 seed 的完整九項集合（八個 type actions 加 global manage_media，包含 type/predicate/surfaces；忽略 id／createdAt），只有整份完全一致才在同一交易展開，並保留 global manage_media。類型／種子執行順序須在施工圖列明，不能在新庫類型尚未登錄時產生空 grants。
- clinic 既有 seed 帳號的 role assignments 也必須完全符合舊標準（單一 operator，原五類型 allowlist）才自動追加 appointment_request；任何 assignment 差異都原樣保留並明確回報未套用，不用 seedUser 的整份 replace 覆寫其他角色或客製類型範圍。
- 任一 grants 差異都視為客製：不覆寫、不丟棄、不自動加入該帳號的 appointment_request allowlist；明確回報「新預約權限種子未套用」，保留應用啟動及既有 Admin 管理路徑。由管理者明確設定後才能認定該客製資料庫完成 Q-26；標準新庫／標準舊庫的自動升級與客製庫的保留／可管理性各有測試。
- 這項政策保留全部非標準客製資料，但未來新 type 不再因加入 operator allowlist 就取得全套動作，還須在現有角色矩陣新增明確 grants。此預設改動與標準資料轉換已於2026-10-06獲批准B；不能只改初始化seed就宣稱所有既有資料已修復。

**C：本輪暫緩 Q-26，只細化其餘七題。**

- 保留現有 RBAC；預約申請作業仍維持目前只有 admin 可讀的缺口。
- 要明確修訂 BW6/W6 範圍與路線圖，不能把 Q-26 勾成完成。

本輪依已批准 B 細化，不降低 Q-26 的 API 安全斷言、不新增依賴。接續決定記錄在 [02 §8](02-backend-sdd.md#8-開放問題)。

## 獨立審查與建議依據

獨立審查已實際核對 seed、matcher、list/capabilities、五角色決策及兩種角色 PUT。B 可用現有 `(action, contentTypeCode)` grants 精確表達 Q-26，不需第六角色或新增授權原語；root 採 B 為建議，理由是保留現有模型並將變更集中於明確的預設種子與升級政策。上述新／舊／客製資料規則已由owner於2026-10-06批准；完整施工圖仍需獨立審查與必要CI／合併，不以決策盤點代替DOC_READY。

## 本輪細化的驗收狀態

- 原八題、現行事實與待決衝突有來源，並由隔離 Codex worker 交叉盤點；root 已讀報告並交叉核對來源，獨立 review 完成；owner已選B，完整細化與驗收另見 [BW6施工圖](waves/BW6.md)。
- 產品 diff 只能是 docs/v2/**；既有程式／測試／workflow／依賴／BW1a 快照與所有 worktrees 保留。
- 相對連結、來源行號、保護檔案 hash、獨立審查與 evidence gate 由 root 留本機收據。沒有 source 變更，不重跑已通過的完整測試。
- 本檔保留決策盤點歷史；BW6文件發布狀態以施工圖PR／README為準。沒有部署；W5的PR #300已合併狀態不受後續文件細化影響。
