# 04 — 權限、目錄與 Admin Center

## 1. 授權模型

採固定 action 集合與固定角色，搭配明確 resource scope；預設拒絕，沒有 implicit superuser。`RoleAssignment` 是 user、role、scope 的綁定，可有多筆；grant 合併為聯集，v0.1 不做 explicit deny precedence。

scopeType 為 `org | project | pool`；scopeId 指向同 org 實體；可選 `stages: ('dev'|'staging'|'prod')[]`，省略表示三者；只適用 project scope，pool/org 不接受 stages。RD 必須 project scope；Ops 的資源操作需 pool scope、應用／事件操作需 project scope；Admin 必須 org scope。

組織成員身分不等於應用權限，不能由 teamId 自動放行。seed persona 的具體 grants 可在 Admin effective permissions 中查看。角色切換只選取另一個 seed user，不能修改他的 grants。

| Action | RD | Ops | Admin |
| --- | --- | --- | --- |
| `app.read`, `environment.read`, `release.read`, `observation.read` | 授權 project/stage | 授權 project/stage | 全企業唯讀 metadata；不讀 log/trace 原文 |
| `ci.read` | visibilityProjectIds 與獲授權 project 相交；只顯示可見 placements | 授權 pool；以及 project 下可見關聯 CI 的唯讀摘要 | 全企業 metadata |
| `ci.create`, `ci.update`, `relation.write` | 無 | 指定 pool；新增／修改可見專案需有相應 project scope；relation 兩端都需寫權 | 無 |
| `request.create`, `request.edit`, `request.submit`, `request.cancel`, `request.retry` | 授權 project/stage；edit/cancel/retry 限 requester | 無 | 無 |
| `request.read` | 授權 project/stage | 授權 project/stage **且** pool | 全企業 metadata |
| `request.approve`, `request.reject`, `request.provision` | 無 | project/stage **且** pool；approve/reject 非 requester | 無 |
| `pipeline.trigger`, `pipeline.retry`, `pipeline.cancel`, `release.rollback` | 授權 project/stage；cancel 限 initiator | 無 | 無 |
| `release.approve`, `release.reject` | 無 | 授權 project/stage；非 initiator | 無 |
| `incident.read` | 授權 project/stage | 授權 project/stage | 全企業摘要 |
| `incident.acknowledge`, `incident.investigate` | 無 | 授權 project/stage | 無 |
| `catalog.read` | published 且 allowedProjectIds 有交集 | 與其 project scope 有交集 | 全部 revisions |
| `catalog.write`, `catalog.publish`, `navigation.write`, `model.write`, `access.write` | 無 | 無 | org scope |
| `audit.read` | 可見 domain entity 的安全摘要 | 可見 domain entity 的安全摘要 | 全企業管理稽核摘要 |
| `integration.read`, `integration.test` | 無 | 僅相關 pool 整合摘要；不可 test | org scope；test 是固定結果的 demo |

`pipeline.read`、`job.read` 分別繼承 environment.read、request.read；pipeline/job log 僅 RD/Ops 有對應 scope 時可讀。`capacity.read`：RD 可看 catalog 所允許 pool 的 available 摘要，Ops 可讀自己 pool 的明細，Admin 可讀全企業摘要。CI 中 RD 不顯示 managementIp、cloud account 原生識別等運維欄位。

同一人即使同時有 RD/Ops grants，也不能批准自己的 prod release 或自己的 request。Admin 可以管理他人 grants，但不可修改自己 assignments，最後一個 enabled Admin 不可被撤銷。示範 seed Admin 無 deployment role；權限管理變更需 reason 並寫 audit。

## 2. UI 與資料層一致

導航使用 route registry 的 required action 決定可見性；page guard 防止直接 URL 跳入；button guard 顯示 state-specific reason；MSW handler 仍須再驗證。三層使用同一 policy evaluator 與 context resolver，不各寫一組 if role。

M4 的診斷 detail／topology deep link 依所需 read action 和 entity scope 允許跨 Center，例如 RD 可讀可見的 `/ops/cmdb/:id`，但不取得 CI metadata 編輯權。Center 首頁與清單仍要求該 Center；可讀 detail 不代表可進入 Ops CMDB 清單。

未登入回 401；對 center/action 無權回 403；不存在或 scope 外 entity detail 統一 404，不能洩漏 existence。列表先 filter 再算 total；search、graph、time series、audit 同樣授權。能看到 app 不代表能看到其 shared CI 的其他 tenant-like project placements。

權限變更導致 `policyVersion` 增加；mutation 或導航前使用最新 policy。切換 persona／scope／policyVersion 都清除舊 cache 和選中 detail；在途 response 帶舊 identity epoch 時丟棄。角色撤銷後已有 dialog 的 confirm 仍要被 handler 拒絕。

這些是展示前端業務行為的權限；真實模式必須由 backend 根據 session 驗證，忽略客戶端 role／project claim。Mock 的 persona header 或 sessionStorage 均不是生產 authentication。

## 3. 三種「目錄」分開治理

| 配置 | 管理內容 | 邊界 |
| --- | --- | --- |
| 導航目錄 | label、group、order、enabled，對已註冊 routeKey 編輯 | 不允許任意 URL／JS／component code，不可修改 required permission |
| 服務目錄 | 面向 RD 的 template、allowed provider/pool/stage、規格限制、revision | catalog 發布才出現在 RD；既有申請保留 templateSnapshot |
| CMDB 模型目錄 | 固定 CI kinds 與自訂可選欄位 label/type/constraints | 不在首版任意刪除核心 kind、改 identity 或執行腳本 |

導航預览可選 RD/Ops/Admin persona，只展示該 persona effective menu。`/admin/access`、`/admin/navigation` 與 `/guide` 的 recovery entry 不能被停用；未知 routeKey 在儲存時 422。隱藏 menu 不改 API 授權，也不表示撤銷功能權限。

Catalog revision：修改 published item 產生下一個 draft revision；publish 在一次 mutation 使新 revision 成為 current，舊 published revision 保留 history；disabled 阻止新 draft request，已 submitted/approved request 依 snapshot 繼續。撤回 submitted 前的草稿若引用 disabled catalog，submit 需重新選有效項目並建立新草稿。

CMDB field constraint 初版支援 string 的 maxLength／enum，number 的 min/max，boolean 無額外條件；不接受任意 regex/code。組織樹初版唯讀，user enabled 狀態與 role assignments 可配置；建立組織／使用者與 SSO provisioning 留待後端整合。

## 4. 平台整合

AWS／Aliyun／IDC、CI provider、APM provider 使用 `Integration` metadata，展示 endpoint label、mapping、state、最後模擬同步、錯誤摘要。v0.1 無密鑰欄位；「測試連線」按鈕標示「模擬測試」，走固定 scenario，不呼叫真實網路。

後續 provider adapter 分別提供 inventory／delivery／observation contracts。CMDB provider 是 AWS／Aliyun／onprem；CI 或 APM 的 vendor 不應被塞進這個 enum。`prism` 可作 observation adapter 候選，不預設它已提供 dim-gate 所需的 BFF contract。

## 5. 必須覆蓋的拒絕案例

- RD Commerce 讀 Data project 的 detail、aggregate、graph、search，均無資料外洩。
- Ops 只有 project grant、沒有 pool grant 時，不能批准該 pool 的環境申請。
- Admin 沒有 RD grant，直接 POST pipeline 被拒絕；改 menu enabled 也不會放行。
- 同一 user 自批 prod release 被拒；切另一 persona 後可批准，但 audit 顯示真實 initiator/approver。
- 從別的 tab 複製 request ID 不表示分享了 state 或取得了權限。
- permission revoked、entity changed、catalog disabled、navigation hidden 各有不同可讀結果，不能一律顯示「系統錯誤」。
