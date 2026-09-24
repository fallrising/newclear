# 新視窗接續開發 prompt

每個可獨立驗收的里程碑完成時更新。先查 GitHub **最新 main／PR／CI**，不以本機 branch 名稱或本檔存在推定合併。

```text
請接續開發 fallrising/newclear 的 platform/agent-platform。

先核對 GitHub 最新 main、最近 PR 與 CI，完整閱讀：
https://github.com/fallrising/newclear/blob/main/platform/agent-platform/docs/HANDOFF.md
以及 SDD.md、適用 AGENTS.md、M3-OPENAI-MOCK.md、M3-PUBLISHED-PRICE-PREVIEW.md、M3-FIXTURE-BUDGET.md、M3-GUEST-MODEL.md、M3-MODEL-PROXY.md、M3-EGRESS.md、M3-GUEST-ISOLATION.md 和交接引用的控制／recovery 文件。

已知停止點：
- AT-11-C2b2 已實作 `openai-compatible-https-v1` 固定 HTTPS Chat Completions transport、file-backed `credential_ref`／CA 驗證及 profile-pinned verification (`none`／`commands`／`fixture-m2`)；migration 012 只放寬新 model reference，保留舊 fixture profiles。最新 `make platform-check` 通過 45 個 dependency-free unit tests、200 個 PostgreSQL／HTTP platform tests、Ruff lint／format。兩個需要平台依賴的新測試已移入 `tests_platform`；GitHub Actions run `36008490179` 的 check／web／control-plane 全部通過，含 browser acceptance。本機無 Node/npm。沒有付費／外部 provider call，也沒有使用既有 provider key。Draft PR #82 已建立。詳見 `M3-HTTPS-PROVIDER.md` 與 evidence。
- C2b2 real-KVM acceptance 未通過。Managed sandboxd launcher 忘記使用文件要求的 `sg kvm` supplementary group，`/dev/kvm` open 為 `EACCES`，Cocoon clone 子程序被終止。此 run 留下 1 筆 `allocate=started` 且無 handle／observed／release proof 的 journal intent；舊 197 筆 release proofs 仍全部通過。收尾 node claims／host VMs 為零、無 failed-clone runtime directory／CPU scope、connector／sandboxd 已停、owned PostgreSQL container 為零，但 `drained()` 仍拒絕因 allocation ownership uncertain。沒有手工修改、刪除或重建 journal／fences；測試產生的新 intent／fence 保留。Repo recovery review：`M3-RECOVERY.md` 要求未知 allocation／無 ownership 證據時管理員對帳；inspect 是唯讀且回 `allocation_ownership_uncertain`，release 需要保存的 observed VM，repo 沒有適用此 row 的受支援 reconciliation command/API。不可手動修補／刪除 row、換 state directory、降低 generation 或開 direct driver。需要先決定正式、可稽核的 same-journal recovery 流程，之後才可跑 KVM。使用者列於 `kvm` group；唯讀 `sg kvm` access check 通過。
- AT-11-C2b1（前次切片）增加 private config 中可設定的 OpenAI Chat Completions mock model ID。仍只連控制端 loopback 腳本 mock，guest 無私網例外；保留原短效 token、SQL admission／unknown、terminal gate 與完整 VM 停止。真實 KVM 的成功、request cap 截止、超界 unknown 三案與原 29 項 terminal 隔離回歸通過。固定 workspace assertion 仍要求 m2-result.txt 中 run UUID；只在 loopback mock 送測試專用 run 身分 header，JSON body 不含 fixture_run_id。首次驗收因缺 UUID 安全失敗，已修正並重跑成功。沒有外部 API／自然語言 coding／硬金額上限；amount_decimal 仍 null。以最新 GitHub PR／CI／evidence 為準，不能只憑本檔宣告合併。
- AT-11-C2a（前次切片）以官方 gpt-4o-mini-2024-07-18 公開 Standard 稅前 USD 價格及 128k context 規格，在原真實 KVM／SQL／loopback fixture 通道演練金額預留、合法用量估算結算、unknown 保留全額及 cutoff。須由 operator 明確確認公開 pay-as-you-go 條件，價目 24 小時內到期。這是 preview，不呼叫付費 provider，沒有實際帳單或硬金額上限；amount_decimal 仍 null。
- PR #43 完成 AT-11-A 控制端 model proxy／request ledger；PR #46 完成 AT-11-B opt-in guest mailbox、固定 OpenHands 1.49.2 SDK tool-call、短效 token 更新及 request cutoff 的工具／VM 收尾。
- AT-11-C1（PR #51，交接時已合併且 check／control-plane／web CI 通過）增加 opt-in、固定本機 fixture 的合成 credits：釘住價格版本／上限，按 canonical request bytes 與 max_tokens 預留，合法用量結算；unknown／SIGKILL 保留全額。這不是真實 provider 費率或帳單，`amount_decimal` 仍 null、硬金額上限仍關閉。開始時仍要重新核對 GitHub，不以本檔推定最新狀態。
- Host 經授權 sandbox port relay 拉取 guest request；worker 使用相同 ModelProxy／SQL ledger 呼叫 host loopback fixture。Guest 不需要任何私網例外，上游 credential 只留控制端。
- 新模式一律 AlwaysConfirm；手動／自動 terminal admission 均核對 live ownership／固定政策／額度。額度截止或模型錯誤持久撤權，完整停止證據才釋放 reservation。
- Request UUID、SQL reservation 和 connector delivery intent 均持久；未知 dispatch 不重送、token 更新不重設 cap。已確認 delivery 可接回同 VM／prompt；不確定 completion 無通用 replay。
- 最新 migration 012；C2b2 為新 `openai-compatible:chat-completions` profile model reference 放寬 check。完整 drain／備份後更新 API／worker／connector。全部 real workers 設 MODEL_PROXY_CONFIG 指向 0600 fixture、mock 或固定 HTTPS provider config 才啟用；空值的新 run 保留 legacy guest fixture。Active 模式不符時 fail closed，不自動換模型。Launcher／OCI 不需重建，guest helper 不能原地升級。
- C2b2 最新本機 45 個 dependency-free unit tests 與 200 個 PostgreSQL／HTTP platform tests 通過；GitHub Actions run `36008490179` 的 check／web／control-plane 全通過（含 browser acceptance）。本機 Web 22 項無法執行（無 Node/npm）；C2b2 real-KVM gate 未通過，且同 journal 有 unresolved allocation intent；取得正式 same-journal recovery 決策前不得重跑或 merge。C2b1 的三個真實 KVM 案例與原 isolation 回歸（29 項 terminal 檢查）已通過；開始新工作時仍重新查 CI/evidence。
- Pause 與模型 I/O 競爭時，舊授權 completion 不交付；不能證實安全工具邊界就保持 pausing／容量，可取消或期限回收。不要把 SDK error 當 paused。

使用者已同意外部 API 依賴先以 mock 為主；不要要求現在提供 endpoint 或 key。C2b2 code 已完成，Draft PR #82 的 GitHub CI（run `36008490179`）全部通過，但 KVM 尚未通過且同 journal 有 quarantined allocation intent。Repo 內沒有適用無 handle intent 的受支援 recovery command/API；先向使用者取得正式、可稽核的 same-journal recovery 決策，不手改／刪 row、不換 state dir、不降低 generation、不走 direct driver。任何後續 KVM 都要依決策使用 `sg kvm` 啟動 node／connector、確認 explicit deny-all／zero-warm／empty node，再跑 `mock-https-complete` 和必要 isolation 回歸；所有必要 gates（含 KVM acceptance）完成前不得 merge。模型 snapshot 不固定費率；OpenAI Order Form、稅與價格更正可能使公開價格不是實際帳單。沒有可信帳戶價格及 token 上界就不能提供硬金額上限；unknown usage 不能當零。不要使用主機既有 provider key 作隱含授權。完整 AT-07／AT-11／M3 仍未完成；Claude／Gemini 原生 adapter、streaming、真實自然語言 coding、M4 artifact／export／backup／GC／production 尚未完成。

開發分工：
- 採用一位主代理統合、視需要最多兩位子代理的輕量團隊；子代理可以使用同一模型，不要求不同模型混搭。若本視窗沒有子代理工具，主代理照常獨立完成，不因此阻塞。
- 主代理負責選定切片、介面與資料契約、核心 ledger／migration／proxy／worker 實作、整合、真實 KVM、GitHub PR／CI／合併及最後交接。相依的帳務與生命週期步驟由主代理依序處理；同一 journal／VM／DB 或核心檔案只允許一位寫入者。
- 可先委派一位子代理唯讀查核目標 API 官方協定與 HTTPS／DNS／TLS 邊界，交付可核對來源、適用條件與缺口；不得讀取憑證或呼叫付費模型。另一位子代理可唯讀審查現有 ledger／安全不變量與故障案例，提出具體測試矩陣；主代理確定契約後，才可將互不重疊的測試或文件交給它在隔離 worktree 修改。
- 子代理不得自行啟動／停止共用 KVM 服務、修改 journal／fences、套用共用 DB migration，或推送／合併 PR。主代理整合子代理成果並親自驗證；小而連續相依的工作維持單代理處理，避免為組隊增加等待與衝突。

工作要求：
1. 從最新 main 建立隔離 worktree，只修改 agent-platform，保留他人修改。
2. 先處理 C2b2 quarantined allocation 的正式 recovery gate；不能安全解決前不重跑 KVM。其後補真實 KVM evidence 與 Web check，不要把未完成 gate 宣稱通過。
3. 不提供 host shell fallback，不輸出 token／私密 journal／provider credential；不以全節點 private-IP override 開通模型路徑。
4. VM 停止未獲證明時保留 reservation；不刪 journal／fences、不降低 generation。
5. 已授權提交、推送、建立 PR；只有 KVM acceptance、Web check 與必要 CI 全通過後才合併 main。一般步驟不用再問確認。
6. 定期繁體中文回報；里程碑完成更新 HANDOFF.md、NEXT-PROMPT.md，提供 PR、測試、剩餘工作、是否需我操作與新視窗 prompt。

若仍同一主機：
- 工作區 /home/ckc/test/codex
- 本次 worktree /home/ckc/test/codex/newclear-agent-provider-mock-c2b2
- 私有配置／TLS key／mock credential／SDK payload／logs /tmp/apm3-at11c2b2-20260924，勿公開原文；C2b1 `/tmp/apm3-provider-mock-20260924` 與更早目錄保留。
- 沿用 /tmp/apm3-egress-20260923/journal 與 fences、terminal、/tmp/apm2-20260922 Cocoon cache／runtime；全部舊交接目錄保留。
- 本次收尾 VM／claims 為零；原 197 筆 journal stop proofs 全部有效，另有 1 筆 C2b2 allocation intent 保持 unresolved；connector／sandboxd 已停、測試 Postgres 已移除。不能把此狀態當成 drain pass，開始前仍要先解決 quarantine。
- Node 保持 explicit deny-all。開始前重新核對服務／VM／claims 與停止證據；同 journal 不可同時開 HTTP connector 與 direct driver。不假設 localhost:15000 registry 仍可拉取。

現在核對最新 GitHub main／PR／CI 與 recovery 文件，先解決 C2b2 journal quarantine；未有安全 recovery 前不可再次配置 VM。
```
