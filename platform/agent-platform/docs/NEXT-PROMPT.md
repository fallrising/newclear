# 新視窗接續開發 prompt

每個可獨立驗收的里程碑完成時更新。先查 GitHub **最新 main／PR／CI**，不以本機 branch 名稱或本檔存在推定合併。

```text
請接續開發 fallrising/newclear 的 platform/agent-platform。

先核對 GitHub 最新 main、最近 PR 與 CI，完整閱讀：
https://github.com/fallrising/newclear/blob/main/platform/agent-platform/docs/HANDOFF.md
以及 SDD.md、適用 AGENTS.md、M3-GUEST-MODEL.md、M3-MODEL-PROXY.md、M3-EGRESS.md、M3-GUEST-ISOLATION.md 和交接引用的控制／recovery 文件。

已知停止點：
- PR #43 完成 AT-11-A 控制端 model proxy／request ledger。
- 最新切片 AT-11-B 已接通 opt-in guest mailbox、固定 OpenHands 1.49.2 SDK tool-call、短效 token 更新及 request cutoff 的工具／VM 收尾。
- Host 經授權 sandbox port relay 拉取 guest request；worker 使用相同 ModelProxy／SQL ledger 呼叫 host loopback fixture。Guest 不需要任何私網例外，上游 credential 只留控制端。
- 新模式一律 AlwaysConfirm；手動／自動 terminal admission 均核對 live ownership／固定政策／額度。額度截止或模型錯誤持久撤權，完整停止證據才釋放 reservation。
- Request UUID、SQL reservation 和 connector delivery intent 均持久；未知 dispatch 不重送、token 更新不重設 cap。已確認 delivery 可接回同 VM／prompt；不確定 completion 無通用 replay。
- 新 migration 009；完整 drain 後更新 API／worker／connector。全部 real workers 設 MODEL_PROXY_CONFIG 指向 0600 fixture config 才啟用；空值的新 run 保留 legacy guest fixture。Active 模式不符時 fail closed，不自動換模型。Launcher／OCI 不需重建，guest helper 不能原地升級。
- M0 45、平台 176 測試通過；新模型 13 個真實 KVM 案例含雙 VM 跨 run、29 項 terminal 隔離、rotation／expiry／revocation 與三個 SIGKILL 時點；另回歸原 13 個控制案例。以最新 evidence／CI 為準。
- Pause 與模型 I/O 競爭時，舊授權 completion 不交付；不能證實安全工具邊界就保持 pausing／容量，可取消或期限回收。不要把 SDK error 當 paused。

下一里程碑 AT-11-C：可信 pricing／token 上界、金額 reservation／settlement，再接 usage UI 和明確 opt-in provider smoke。
先比較 SDD 與現在的 request cap／fixture usage，選擇可獨立驗收的切片。沒有可信價格或 tokenizer 上界就不能提供硬金額上限；unknown usage 不能當零。不要使用主機既有 provider key 作隱含授權。完整 AT-07／AT-11／M3 仍未完成；streaming、真實自然語言 coding、M4 artifact／export／backup／GC／production 尚未完成。

工作要求：
1. 從最新 main 建立隔離 worktree，只修改 agent-platform，保留他人修改。
2. 直接完成實作、適當測試、真實 KVM 證據與交接；不要停在計畫。
3. 不提供 host shell fallback，不輸出 token／私密 journal／provider credential；不以全節點 private-IP override 開通模型路徑。
4. VM 停止未獲證明時保留 reservation；不刪 journal／fences、不降低 generation。
5. 已授權提交、推送、建立 PR，必要 CI 全通過後合併 main；一般步驟不用再問確認。
6. 定期繁體中文回報；里程碑完成更新 HANDOFF.md、NEXT-PROMPT.md，提供 PR、測試、剩餘工作、是否需我操作與新視窗 prompt。

若仍同一主機：
- 工作區 /home/ckc/test/codex
- 本次 worktree /home/ckc/test/codex/newclear-agent-m3-guest-model
- 私有配置／模型 payload／logs /tmp/apm3-guest-model-20260923，勿公開原文。
- 沿用 /tmp/apm3-egress-20260923/journal 與 fences、terminal、/tmp/apm2-20260922 Cocoon cache／runtime；全部舊交接目錄保留。
- 本次收尾 VM／claims 為零、97 筆 journal 對應 VM 全部停止，connector／sandboxd 已停、測試 Postgres 已移除；這是交接時證據，不能取代開始前重新核對。
- Node 保持 explicit deny-all。開始前重新核對服務／VM／claims 與停止證據；同 journal 不可同時開 HTTP connector 與 direct driver。不假設 localhost:15000 registry 仍可拉取。

現在核對最新進度並繼續開發。
```
