# 開發接續紀錄 — 2026-09-23

本次停止點：**PR #40 的固定節點 egress 已合併；AT-11-A 控制端 model proxy／request ledger 切片已完成。Guest／OpenHands 尚未接入新 proxy，完整 AT-11／AT-07／M3 仍未完成。** 本次分支 `agent/agent-platform/m3-model-proxy` 從當時最新 main `707f77d2c670b6a344ef25d9c4204521223687c1` 建立，提交前同步 main `2069f59222780d52055bef139953d689c353e902`，只修改 `platform/agent-platform`。最新行為見 [M3 model proxy](M3-MODEL-PROXY.md)，新視窗接續見 [NEXT-PROMPT.md](NEXT-PROMPT.md)。

## 本次 AT-11-A 控制端 model proxy

- 新增 `008_model_proxy.sql`、獨立 loopback model endpoint、私有管理 CLI。Token 只以 hash 入 DB，最多五分鐘／run deadline；每筆 admission 核對 running、generation、owner、live job lease、固定模型、binding 與未釋放 reservation。
- Run 首次發放 pin 住政策 digest 與 1–100 次 request cap，並行先 reserve 再呼叫。Rotation／worker generation／restart 不重設額度；重複 request ID 不重派，payload 改變回 conflict。
- 429／timeout／損壞／敏感回覆是 unknown；SIGKILL 後 reserved 保守留存。合法 fixture token counters 可 final，金額永遠 null／unknown，沒有可信價格／token／金額硬上限。
- Cancel 不等待上游 I/O；已 admission 的請求可能完成，仍保存用量，舊授權結果不回傳。Proxy 不釋放 VM reservation，不碰 KVM journal／fences／generation。
- **僅本機受控文字 fixture，沒有付費 provider、tool-call／streaming 或 guest transport。** 原有 guest fixture 繼續照舊；UI `usage` capability 保持 false。新 API `GET /api/v1/runs/{id}/usage` 明確標示 `guest_connected:false`／`configured`／未知費用。
- 新增 32 項 SQL／HTTP／process crash 測試；M0 45 項／平台 161 項與 lint／format 通過，完整測試結果見 [證據](evidence/m3-model-proxy-2026-09-23.json)。本次不宣告新的 KVM／provider 驗收。
- 新 worktree `/home/ckc/test/codex/newclear-agent-m3-model-proxy`；私有測試 logs 在 `/tmp/apm3-model-proxy-20260923`。既有 `/tmp/apm3-egress-20260923` deny-all 配置、launcher 與全部 journal／fences 保留。沒有啟動 KVM node／connector，測試 Postgres 與 proxy process 由測試清理。
- 升級先 drain、備份、套用 migration 008。沒有切換 worker／guest 模型路徑、不需要重建 launcher；新服務只用獨立 fixture key，不需要 provider key。下一個切片必須驗收 guest 通道再切換模型。

## 本次固定節點 egress

- 固定 sandboxd 0.1.12 的 none-lane **仍可經 vsock proxy 出站**。本切片開啟受控 proxy，提供 exact host／port／method allowlist、解析後 IP guard、redirect 下一跳驗收；不把 net=none 或 proxy 未啟動當安全保證。
- `egress_node` 固定 binary hash、sealed memfd 配置及啟動 argv；connector 核對 live PID／start ticks／boot ID、binary、seal、內容與 API listener ownership。拒絕內網 override、wildcard、SOCKS、secrets、tenant／NIC／preview 等未驗收路徑。
- `007_egress.sql` 保存 catalog／run 政策 digest，不可變 profile 也固定 digest。Queued 舊 run 或舊 profile 不會借用新政策；舊 journal 缺政策證據時拒絕繼續，取消／停止對帳仍可使用。
- **政策不支援 live replacement**：執行中配置不可改寫，pool API 拒絕政策 mutation；先 drain、核對所有 VM／claims／原程序／runtime directory／cgroup 已停止，再重啟 node。Mismatch 不表示既有流量立即撤銷，reservation 沒有停止證據就保留。
- Terminal launcher 新增固定 loopback proxy 環境，guest helper 核對沒有可用 NIC。依 [guest isolation](M3-GUEST-ISOLATION.md) 重建 0600 launcher 並更新 digest；UID 2001／2000、NoNewPrivs、控制 workspace 隔離不變。
- M0 45 項、平台 129 項與兩項固定上游 DNS 契約測試通過；真實 KVM egress、deny-all 政策變更與既有控制流程回歸，見 [證據](evidence/m3-egress-2026-09-23.json)。Redirect 證據要求源站真回 302，沒有拿公開測試站自己的 403 當平台拒絕。
- 升級 API／worker／connector，drain 後 migrate／sealed node 啟動／register-runtime／新 profile revision。Connector 與 sandboxd 須同服務 UID／GID，本機兩者一致經 `sg kvm` 啟動以讀取 `/proc`；不放寬程序權限。
- 本次私密測試配置、launcher、journal／fences、Go 測試工具鏈在 `/tmp/apm3-egress-20260923`，`connector.json` 最後為 explicit deny-all，allow fixture 保存為 `connector-allow.json`。同一 journal 的 direct driver 與 HTTP connector 不可同時執行。保留舊測試目錄及全部 journal。

## 本次 guest 控制憑證隔離

- Agent Server／固定模型使用非 root UID 2001，terminal 維持 UID 2000。私有控制 HOME／state／tmp／SDK workspace 與實際 repository 分離，封閉同 UID `/proc` 憑證讀取及 ambient plugin／import 注入。
- 固定 static launcher 僅在 guest 安裝 root:2001 mode 4750，只允許控制帳號啟動 UID 2000 shell；固定環境、清除 groups／FD／saved identity、NoNewPrivs 與 core dump 限制。沒有 host setuid 或 shell fallback。
- Prepare／prompt／approval／recovery／quiescence／result 核對 helper hash、權限與程序 UID。舊 journal 缺 revision 時拒絕繼續，但保留取消與完整停止回收。
- 新增八項 host 契約／編譯測試；平台共 116 項、M0 45 項通過。23 項真實 terminal 攻擊檢查、兩個 output canary 案例與 13 個控制回歸通過，見 [證據](evidence/m3-isolation-2026-09-23.json)。
- **升級先 drain**；以 `python -m agent_platform.build_terminal` 建立 0600 launcher，將輸出的 file／SHA-256 加入私密 connector 配置。保留 journal／fences；沒有新 migration，不原地修補舊 guest。

## 輸出安全切片（PR #30）

- 統一涵蓋 connector／node／sandbox／session 四種憑證；在 JSON 解碼後檢查巢狀 key／value，再遮蔽與截斷事件。含憑證的 ID／kind／state 與審批參數直接拒絕。
- 嚴格驗證 result 欄位、固定 base SHA、UTF-8 patch bytes／SHA-256／256 KiB 與 fixture assertion。含憑證或損壞的 patch 不存入 result、不宣告成功；保留容量直到停止證據確認。
- 新增 10 項安全回歸，平台共 108 項、M0 45 項通過；兩個真實 VM 驗收事件遮蔽、secret diff 拒絕、跨 workspace 隔離、目前 deny-all 網路及完整清理。
- 當時發現同 UID terminal 可讀取 session key；本次以控制／工具 UID 分離修復並重驗。輸出遮蔽仍只比對完整已知憑證，不是任意編碼防洩漏保證。
- 當時 proxy 未開啟的觀測不等於產品 egress policy 驗收；allowlist／DNS／redirect 已由本次固定節點切片補驗。Live policy mutation、model proxy／budget 仍未提供。

## M3 pause／resume 已完成

- `006_pause.sql`、pausing／paused／resuming、CAS／命令收據、generation 撤權、舊審批失效與完成 audit。
- AlwaysConfirm 關閉 terminal admission；初始 message `run=False` 初始化工具後收集 root-owned guest 程序基準。持鎖的 live WebSocket full_state、工具邊界、boot／PID identity 全部確認後才 paused。
- **REST ConversationInfo 在固定版本讀 autosaved state，可能落後控制 mutation。** 控制之後改用新訂閱 full_state，只選取控制欄位，不把 private snapshot 保存為 history／SSE。
- 恢復保持原 VM／prompt，還原原政策；需審批者產生新 generation grant，不因 resume 自動核准。未知 run ACK 不重送；完成收據可對帳。
- Paused 保留資源與原期限，定期核對，支援取消與到期直接回收。恢復成功交回普通 queue，控制執行緒持續可用。
- 新增 18 項後端與四項 UI 測試；六個真實 KVM 暫停案例及 recovery／cancel／approval 回歸，見 [證據](evidence/m3-pause-2026-09-22.json)。

## M3 approval 已完成

- `005_approvals.sql`、OpenHands profile `require_approval` opt-in、AlwaysConfirm、完整批次 digest／generation／五分鐘 expiry／live lease／CAS 決策。
- Connector 核對原 VM 與同一批 pending terminal actions 後才放行；持久 intent 與收據，未知回覆不重送、容量保留。
- 已完成 connector 收據可補登 applied／audit；worker 接管或參數改變須重新審批，不重建 VM／prompt。
- 工作台完整參數、核准／拒絕、原決策重試；拒絕走安全取消。當時一般 pause／resume 維持 capability gate；目前已由下一切片啟用。
- 16 項新增後端審批測試、三項 UI 測試、真實 KVM 核准／拒絕與取消回歸；證據見 [M3 approval](M3-APPROVAL.md)。

## M3 cancel 已完成

- `004_cancel.sql`、原子取消命令／冪等收據／state version、generation 撤權、取消請求與完成時間、完成 audit。
- 專用取消處理執行緒；四個普通 worker 卡住時仍可取消。Queued 直接取消，已配置任務必須確認原 VM 停止；未知狀態保持 cancelling 並保留容量。
- Connector 取消 tombstone、bounded interrupt＋VM release；完整停止證據才完成取消，未知 allocation ownership 不猜測成功。
- OpenHands 工作台取消／pending／重試流程；暫停／繼續／審批維持 capability gate。
- 新增 15 項後端取消驗收、兩項 UI 互動測試、真實 VM 配置中及 120 秒 terminal 命令取消、三個同 VM recovery 回歸案例；見 [M3 cancel](M3-CANCEL.md)。

## M3 recovery 已完成

- `003_recovery.sql`、原 binding／reservation 的 recovery queue、接管 generation、`interrupted_from`／`reconciled_at` 與接管 audit。
- Connector 獨立持久 lease fence；核對原 claim／VMM identity／固定 Agent Server／conversation 後接續事件，不重複 VM／prompt。
- 未知 upstream mutation／partition 保留容量；已確認原 VM 完全消失後才回收。無 ownership 證據的未知 allocation 仍須管理員對帳。
- 新增 19 項 recovery 測試：九個 SIGKILL 時點、未知 ACK、重啟、stale generation、partition、PID 重用、競爭及到期鎖等待。
- 三個真實 VM 恢復案例與原四 VM／第五排隊回歸通過；證據與限制見 [M3 recovery](M3-RECOVERY.md)。

## M2 已完成

- Cocoon／OpenHands 私有 connector、固定 template 與管理員登錄的 readonly Git bundle、非 root guest checkout、真實 terminal 工具執行、持久事件及 bounded diff。
- Connector 私密 durable operation journal、generation／payload gate、不確定操作不重送；worker 四任務並行與 heartbeat。Fake／real 混用仍遵守全平台四 slot 上限。
- 四個真實 VM 並行、第五 queued、workspace 隔離；VMM／VM record／runtime directory／cgroup 均確認消失後釋放容量。
- 真實 Chromium／PostgreSQL／HTTP 的 100-event reconnect／reload／不重複執行驗收；unsupported UI／API gate 與安全文字 diff。
- `002_runtime.sql`、runtime catalog、`register-runtime`／`connector` CLI、path-scoped CI browser acceptance。證據見 [M2 evidence](evidence/m2-2026-09-22.json)。

## 下一步

1. 依 [SDD](../SDD.md) 與 [M3 model proxy](M3-MODEL-PROXY.md) 接續 **AT-11-B guest transport／SDK tool-call dialect／憑證 rotation**，真實 KVM 驗收後再接 pricing／token／金額 budget、工具收尾與 usage UI，最後整合完整 AT-07。固定節點 egress 已驗收，project-specific policy／即時撤銷／TLS 內容政策仍不支援；模型 transport 不得靠全節點 private-IP override 開洞。AT-04／05 recovery、AT-06 approval 與 AT-08 cancel 的固定模式能力和保守邊界已記錄，不把它當成完整 M3。
2. **M2 仍使用固定模擬模型**：只執行 `m2-result.txt` 的驗收，不解讀自然語言任務，不呼叫付費 provider。控制端 fixture proxy／request ledger 已提供；guest 尚未接入，真實 provider／token 與金額 budget／usage UI 尚未提供。
3. `connector.py`／`connector_journal.py` 擁有上游操作與私密 state，`runtime_worker.py` 擁有平台生命週期。沒有足夠停止證據時 reservation 必須保留，不得把 restart 當作重新配置授權。
4. 任務輸入只允許 catalog 中的 canonical repo／base SHA；目前以 8 MiB 以下固定 bundle 提供 repository，沒有任意遠端 clone／私有 GitHub credential 流程。
5. OpenHands cancel、pause／resume 已開啟；approval 由 profile opt-in。M0 primitive 通過不代表 M3 平台安全語意已完成；不要提供 host shell fallback。
6. 256 KiB 以下 diff 與 fixture verification 保存於 DB；M4 的 artifact store／download、explicit export、backup／GC／production 仍未完成。
7. 重跑 KVM 使用專用 zero-warm node；本機私密測試目錄 `/tmp/apm3-egress-20260923`（本次，最終 pinned-*／deny-final／控制回歸）、`/tmp/apm3-isolation-20260923`（前次，使用 nonroot-* 最終證據）、`/tmp/apm3-security-20260922`（輸出安全）、`/tmp/apm3-pause-20260922`（pause）、`/tmp/apm3-approval-20260922`（approval）、`/tmp/apm3-cancel-20260922`（cancel）、`/tmp/apm3-20260922`（recovery）與 `/tmp/apm2-20260922`（cache／runtime）保留。測試結束 connector／sandboxd 已停、VM／claims 為零。不要輸出 token／journal 原文。M0 registry 已移除；使用既有 Cocoon cache，不能假設 `localhost:15000` 可拉取。
8. 本次先 drain、備份，再套用最新 `008_model_proxy.sql`（包含前序 migrations）並更新 API；proxy 為獨立服務。從 PR #40 升級不需重建 launcher 或切換 guest 模型。若從更舊的 guest／egress 版本升級，仍須依其文件一起更新 API／worker／connector／web、重建 launcher、以 sealed node 啟動並重新登錄政策／建立 profile revision。舊 journal 沒有 pre-tool 程序基準不能安全 pause。不要刪 journal／fences 或降低 DB generation；先 drain 再 migrate。已進入 guest 的工具不會因 worker lease 到期而自動停止。

## 必須保留的契約差異

- `template_digest` 是 promoted snapshot export digest，不是 OCI manifest digest；目前 probe 使用 configured pool／cold OCI claim。
- OpenHands `/interrupt` 只證實 paused；sandbox release ACK 與 claim-list 消失也不能單獨證實 VM 已停止。
- 每次 WebSocket 訂閱的首幀 full_state 快照不屬於持久化 history。
- SDK 0.1.12 wheel 的 sandbox.py 與研究時 source revision 不完全相同；exec timeout 不代表 guest 程序已終止。
- Session／sandbox token 從本機環境或 secret store 提供，不提交到 repository；沒有模型 provider key 需求。

設計見 [SDD](../SDD.md)，驗證命令與證據見 [M0](M0.md)，主機安裝與遠端執行見 [KVM-HOST](KVM-HOST.md)。
