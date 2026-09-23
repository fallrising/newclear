# 12 — Admin 平台管理台 SDD

版本：WS-SDD revision 1 · 狀態：W1 已驗收合併；W2 已實作且本機驗證完成，待最終 CI／接受／合併，固定證據見 [STATUS](../STATUS.md)；W3–W5 為後續設計；共用語義見 [09](09-shared-workspaces.md)，能力對照見 [13](13-capability-map.md)，驗收見 [14](14-workspace-delivery.md)。

## 1. 責任與權限邊界

Admin 面向 dim-gate 平台的開發與管理者，負責組織使用者、授權、功能入口、模板、整合及平台配置。首頁首先回答「平台哪些配置需要處理、誰能使用什麼、整合與通知是否可用」。它可以有面向平台開發者的註冊與診斷工具，但不是 production shell、部署伺服器或業務 superuser。

平台原始碼開發、CI 與正式發版沿 repository 流程；console 不提供任意 JS、SQL、shell、plugin 上傳或雲憑證操作。若 Admin 同時需要業務研發／維運能力，另授 RD/Ops action + scope，工作區切換不替他授權。

## 2. 導航與首頁

| 導航組 | 入口 | 內容／階段 |
| --- | --- | --- |
| 平台總覽 | `/admin` | 待發布配置、整合錯誤／stale、近期權限變更、模擬通知失敗；W1 先投影現有資料。 |
| 身分與授權 | `/admin/access`；規劃 `/admin/users` | 既有 enabled/assignments/effective preview；W5 加虛構使用者與團隊管理。 |
| 入口與能力 | `/admin/navigation`、`/admin/catalog`、`/admin/cmdb-models` | route registry 導航、版本化服務模板、可選欄位；W2 同步擴充選定資源模板。 |
| 平台配置 | 規劃 `/admin/features`、`/admin/routes`、`/admin/notifications` | 平台功能灰度、整合入口路由、通知渠道／政策；W5。 |
| 整合與稽核 | `/admin/integrations`、`/admin/audit` | adapter safe metadata、固定模擬測試、correlation 稽核；沿用既有功能。 |

首頁統計必須能定位實際配置／事件；不把「Admin 可看全企業 metadata」變成原始 trace、log、連線秘密或所有業務 payload。新配置未存在時顯示 empty／尚未設定，不顯示固定成功數字。

## 3. 選單、能力與授權是不同層

| 層 | Admin 可以改 | 不可以藉此改 |
| --- | --- | --- |
| Navigation | 已註冊 routeKey 的 label/group/order/enabled；工作區預覽 | required action、任意 URL/code、尚未實作的 component |
| Capability registry | 查看 capabilityId、實作狀態、支援 scope/provider、route/action/schema references | 瀏覽器任意定義 executable capability；註冊由程式碼 PR 及 schema 驗證完成 |
| Catalog | 某能力的安全模板、允許 project/pool/stage、limits/revision/status | 擴張 underlying action、在模板嵌入 script 或憑證 |
| Access | 固定角色的 scope assignment、使用者 enabled、effective permissions 預覽 | 隱藏 menu 代替撤權、Admin 隱含執行所有資源／部署操作 |
| Feature policy | 已註冊功能在哪些已授權使用者中顯示／可用 | 調高權限，或用 feature flag 跳過 API 授權 |

既有 `/admin/access`、`/admin/navigation`、`/guide` recovery entry 不可停用。feature/route 也不能遮蔽 recovery；未知 key 回422。停用 menu 不刪 domain，也不撤銷既有 API grant。Feature policy 若控制 command 可用性，由 domain 在 command 時檢查，不只隱藏按鈕。

## 4. 使用者與組織（W5）

v0.1 已支援使用者 enabled 與 assignments，組織樹唯讀。W5 的新增 Mock 允許建立／編輯**虛構本地使用者**、team membership 與顯示名稱；不發邀請、不新增真實帳戶、不做登入、SSO 或 SCIM。真實身分生命週期仍屬 integration SDD。

使用者欄位：stable userId、displayName、teamIds、enabled、source=demo、version；不收密碼、真 email 或 access token。建立時無任何 role assignment。team membership 變動不產生 grant；刪除不開放，停用保留歷史 actor。每次 access mutation 要 reason、expectedVersion、policyVersion 更新及有效權限預覽。

不可改自己的 assignments 或停用自己；最後一個 enabled Admin 不可撤銷／停用。給其他人 Admin grant 必须顯示影響並留 audit；本輪維持固定角色與 scope，不增任意 deny policy editor。新使用者若要作 Demo persona，需明確加入可切換名單，不能讓存入 User 自動變成登入通道。

## 5. 平台功能灰度（W5）

PlatformFeaturePolicy 欄位：featureKey（registry allowlist）、revision、status、target center、eligible projectIds/teamIds?、rolloutPercent（0–100整數）、saltVersion、reason、createdBy、activatedAt?。只在既有 grant 與 capability 支援的集合內選 cohort；實際 eligibility = 授權 ∩ capability 可用 ∩ cohort，關閉 policy 不刪資料。

Mock cohort 使用穩定 userId + featureKey + saltVersion 的 deterministic bucket；百分比調整不使用隨機數導致刷新跳動。預覽列出有權查看的示範角色結果及原因，不暴露未授權使用者。啟用前驗證 recovery entries、不相容依賴及目標範圍。

配置流程：draft → validated → active/disabled；啟用、停用都需 diff/reason/version，回復建立新 revision。這是有 audit 的平台配置，W5 不假稱已有雙人批准或完整平台發布引擎；若未來要高風險配置雙人審批，須另擴 action/decision contract。Feature 停用需禁止新 command，既有進行中的 execution 繼續依其批准 snapshot 結束並可讀。

## 6. 平台路由（W5）

PlatformRoute 指向已註冊 adapter／capability：routeKey、integrationId、capabilityId、adapterRef、timeoutMs、enabled、revision、health summary。routeKey 不是任意 pathname，adapterRef 不是 URL 輸入框。Demo 只做已註冊模擬 adapter 的解析、失敗與 fallback 狀態演示，不代理網路、不建立 gateway、不改 DNS。

驗證：key 唯一、能力支援、integration 存在、固定 timeout 範圍、不可形成 alias loop、不可覆蓋平台 recovery/API base。替換 adapter 保留歷史 audit 與引用版本；測試路由清楚顯示「模擬」和採用的 revision。

| 同名概念 | 所屬角色 | 管理物件 |
| --- | --- | --- |
| 平台功能灰度 | Admin | dim-gate 功能是否向已授權 cohort 提供 |
| 業務版本灰度 | RD 申請、Ops 批准 | 某服務環境各版本的流量與健康條件 |
| 平台整合路由 | Admin | 已註冊能力如何選 adapter／入口 |
| 業務流量路由 | RD 定義、Ops 核對 | 服務 host/path/版本權重；基礎網路操作另需 Ops pool 權限 |
| 基礎網路／DNS／gateway 運行 | Ops | pool、network、LB、DNS、cert 等資源的配置與變更 |

## 7. 通知配置（W5，W4 先用固定安全配置）

Admin 管理 NotificationPolicy、Channel metadata、模板 revision、允許使用 scope、severity routing、去重與保留政策。Channel 最小欄位：id、name、kind（in_app/demo_email/demo_webhook）、safe destination label、enabled、allowedProjectIds、version。禁止真收件地址、webhook token、密鑰；「測試投遞」只產生可查的 Mock delivery record。

RD 配置服務的通知訂閱與可用 channel；Ops 觀察／處置告警、維護有期限 Silence；Admin 配置平台可提供哪些 channel 與路由規則。可選 channel 不等於能讀它所有歷史訊息。每個 recipient 的 payload 依其可見 entity projection 生成；無權收件人不收到名稱、總數、trace/log 或 raw diff。

同 eventId + recipient + channel + templateRevision 的 delivery 去重；狀態 queued/suppressed/delivered/failed。重試需新的 attempt 並保留歷史；權限或 channel scope 被撤銷後重新檢查，不重播舊私有 payload。規則不得造成通知自行觸發同一通知的無限循環。Silence 到期只處理仍符合規則的新／持續事件，不一次補寄過去全部事件。

## 8. 平台開發工具與治理證據

平台開發者可唯讀看 capability/route/action/schema 對應、adapter 模擬健康、版本相容性、工作單 correlation 與脫敏稽核；artifact／SDK／framework catalog、BFF governance 等列在能力地圖作後續整合。不得把外部平台的名稱当作 dim-gate 已實作功能。

所有平台配置明示 draft、active revision、變更者、驗證結果及資料時間。Integration 錯誤、沒有資料、故障注入、停用是不同狀態。沒有真執行器時「測試成功」只表示指定 Mock 情境通過。

## 9. Admin 的可驗收結果

對應 REQ-WS-01/06/08/09/10；驗收 AC-WS-01/02/12～18。主線：調整已註冊入口 → 預覽不同角色 → 发布 catalog revision → RD 看到合法模板且舊申請不變 → 修改某使用者 grant → 舊 dialog 的提交被 domain 拒絕。W5 再驗證平台功能 cohort、路由與通知；它們的成功不得賦予 Admin 業務發布或共享資源執行權。


W2 本機驗證 checkpoint（2026-09-23）：產品 `4a69e07` 通過321項原生測試、77/77 Chromium、2/2隔離；最終修正 `bf3f168` 通過8/8 Firefox／WebKit、實際版面／鍵盤檢查及3/3效能。獨立review關閉F01–04；仍須最終PR head CI、主控接受與實際合併，**尚未宣稱 W2 ACCEPTED/MERGED**。完整AC與歷史失敗以 [STATUS](../STATUS.md)、[W2驗證報告](../../../../.team/reports/dim-gate-w2-validation.md) 和PLAN為準。W3–W5、後續／待釐清能力尚未實作。
