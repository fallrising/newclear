# 新視窗接續開發 prompt

此檔在每個可獨立驗收的里程碑完成時更新。請以 GitHub **最新 main** 的 HANDOFF 與實際 PR／CI 狀態為準，不以本機分支名稱推定已合併。

複製以下內容到新視窗：

```text
請接續開發 fallrising/newclear 的 platform/agent-platform，沿用既有設計與進度。

先核對 GitHub 最新 main、最近 PR 與 CI，完整閱讀：
https://github.com/fallrising/newclear/blob/main/platform/agent-platform/docs/HANDOFF.md
再讀 SDD.md、適用的 AGENTS.md、M3-MODEL-PROXY.md、M3-EGRESS.md、M3-GUEST-ISOLATION.md，以及交接引用的控制／recovery 文件。避免重做已完成工作。

已知停止點：
- PR #40 已完成固定節點不可變 egress；不支援 live policy replacement，變更需完整 drain。
- 下一個已完成切片是 AT-11-A 控制端 model proxy：migration 008、最多五分鐘 run token、每 request 核對 run／generation／owner／lease／binding、模型 allowlist、原子 request-count reservation、不可重派 ledger、未知用量與 authenticated usage API。
- 僅支援本機文字 fixture；guest／OpenHands 尚未接入 proxy，tools／streaming／付費 provider／token 與金額硬上限／usage UI 尚未完成。現有 guest 仍用固定 fixture，不能說 agent loop 已受此 proxy 預算限制。
- 上次驗收為 M0 45 項、平台 161 項（新增 32 項 proxy 測試），包含真實 HTTP process 重啟、三個 SIGKILL 時點、並行額度、取消、慢速 header／timeout、secret canary。沒有新的 KVM／付費 provider 證據。

下一個里程碑：AT-11-B guest model transport 與 pinned OpenHands SDK tool-call dialect。
先比較現有 connector／guest relay／worker 與控制端 proxy 的差距，選擇可獨立驗收的整合切片。可評估 host 經受控 port relay 拉取 guest mailbox，但這只是待驗證方向，不是既定可用功能。
要求：provider key 留控制端，guest 只持短效 run-scoped credential；安全更新 token，保留 run／generation／live lease、cancel／pause／recovery 與 unknown dispatch 不重送語意。不要用全節點 private-IP override 開模型通道。模型 cutoff 必須與工具 admission／安全收尾整合，不只回 HTTP 429。
完成真實 KVM 的通道、credential isolation、跨 run、到期／撤權、原控制流程回歸後，再做可信 pricing／token 上界、金額 reservation／settlement 和 usage UI。完整 AT-07／AT-11／M3 仍不能提前標記完成。

工作要求：
1. 從最新 main 建立隔離分支或 worktree，保留他人修改，只處理 agent-platform。
2. 直接完成實作、適當測試、驗收證據與交接；不要停在計畫。
3. 不提供 host shell fallback，不輸出 token／私密 journal／provider credential。
4. 無法證明 VM 已停止時保留 reservation；不刪 journal／fences、不降低 generation。
5. 已授權提交、推送、建立 PR，必要 CI 全通過後合併 main；一般開發步驟不用再問確認。
6. 定期繁體中文回報。每個里程碑完成時更新 HANDOFF.md、NEXT-PROMPT.md，提供 PR、測試結果、剩餘工作、是否需要我操作，以及可貼入新視窗的 prompt。

若仍同一台主機：
- 工作區 /home/ckc/test/codex
- 上次 worktree /home/ckc/test/codex/newclear-agent-m3-model-proxy
- 本次私有測試 logs /tmp/apm3-model-proxy-20260923
- KVM 私有配置／launcher／journal /tmp/apm3-egress-20260923（最後 explicit deny-all；allow fixture 另存），舊 /tmp/apm3-isolation-20260923 保留。
- 上次沒有啟動 KVM node／connector，測試 PostgreSQL 與 proxy process 已清理；開始前仍重新確認 VM／claims／服務狀態。不要輸出私密配置原文。

現在開始核對最新進度並继续開發。
```
