# 接續 Prompt：Mithril 四機實驗

本 Prompt 是交接文件，不會因被閱讀就授權任何遠端操作。預設 mode 是 `plan-only`；Owner 明確選擇 `develop-only` 或批准精確實機變更計劃後，才可進入對應工作。文檔合併不是 runtime PASS。

---

你接手 `fallrising/newclear` 的 Mithril 研究項目。目標是按既有設計，用四台已確認的測試機跑通 Redis Cluster + Mithril 的低流量實驗，再逐階段驗收；不要另造平台，也不要跳到壓測。

## Repository 與完整讀取要求

Canonical repository：`https://github.com/fallrising/newclear`。
SSH remote：`git@github.com:fallrising/newclear.git`。
項目路徑：`labs/mithril-research/`。
上游：`git@github.com:projecteru2/mithril.git`，研究 commit `9959fe2e5cd466614dc20ef7b710befaaf1d746a`。

先查 main、相關 PR／branch、既有工作樹與未提交修改；不要重建已存在的研究，不 reset 他人的工作。使用 GitHub SSH、核對 host key，不停用 StrictHostKeyChecking。確定本機 checkout 後，用 `git rev-parse --show-toplevel` 取得實際絕對路徑；不要假造 `/workspace` 或使用其他 session 的舊路徑。

以下列出從 repository root 起算的完整路徑，必須全文閱讀，超出工具輸出上限就分段續讀，不能只看搜尋摘錄：

```text
README.md
PORTFOLIO.md
docs/taxonomy.md
docs/portfolio-doc-tiers.md
docs/specs/monorepo-ci.md
labs/mithril-research/AGENTS.md
labs/mithril-research/README.md
labs/mithril-research/upstream.lock.json
labs/mithril-research/docs/STATUS.md
labs/mithril-research/docs/RESEARCH.md
labs/mithril-research/docs/SDD.md
labs/mithril-research/docs/SOURCES.md
labs/mithril-research/docs/VALIDATION.md
labs/mithril-research/docs/quickstart.md
labs/mithril-research/docs/FOUR-NODE-PLAN.md
labs/mithril-research/docs/EXECUTION_PROMPT.md
```

[四機計劃](FOUR-NODE-PLAN.md) 是目前部署順序；[SDD](SDD.md) 保持需求／測例權威；[STATUS](STATUS.md) 是唯一任務狀態帳。資料衝突先指出並作最小文件修正，不默默改變研究 commit 或驗收口徑。

## 已知狀態與第一個動作

Owner 已提供「四台測試機可用」資訊，不要再問有沒有機器。H1–H4 的真實映射、資源與安全邊界尚無本項目現場 evidence；也不能直接假設就是 Eru 那四台。

最先處理 MR-004 / P0：核對既有 inventory 是否有明確授權可供本次使用，列出唯讀盤點方法，確認 OS／架構、host identity、SSH、runtime、Tailscale、port、資源、保留服務與回復入口。未獲准遠端讀取時，先交付可由 Owner 執行的唯讀命令；已獲准時按核准目標執行，不重複詢問已知資料。

盤點只讀必要 metadata，避免讀 secrets、dump 或真實應用資料。敏感結果留在 checkout 外的私有目錄，公開報告使用 H1–H4，不能提交實際 IP、alias、fingerprint、key、密碼或完整日誌。

## 工作模式與停止邊界

`plan-only`：只讀 repository／已授權盤點，整理實機差異、變更清單、風險、回復及批准需求；不安裝或啟動服務。

`develop-only`：另經 Owner 指定後，實作 P1 的最小 lifecycle harness、contract tests、版本鎖定與 root path-scoped CI；使用本機 disposable fixture，不連真實 VPS。介面是待實作契約，不能宣稱檔案已存在。

`execute-approved`：必須已有核准的 H1–H4 身分、plan hash、ports、資源配額、保留清單、credentials 與回復邊界。只做批准的 P1–P3：固定 artifacts → 六實例及交叉副本 → 真實 backend health → Mithril → 小流量使用／SDK → down/up 與精確清理驗收。批准範圍內連續推進，不逐命令要求確認；身分漂移、共享服務異常或新風險才停止。

故障注入、purge 資料、整機 reboot、網路規則或 runtime 安裝／升級都必須在批准變更集中。F07 網路故障及整機操作另行批准。不改 root SSH、tailscaled、共享 Docker/containerd、Eru、kernel、snail，不啟用公網 listener／Funnel，不帶入正式 Redis。

## 必守的技術判斷

初始配置是 H1=M1+R3、H2=M2+R1、H3=M3+R2、H4=Mithril A+client；副本依實際 node ID 明確配對。Redis 六實例不是六台機器，也不是六個投票 master。

Backend health 必須直接檢查六節點，不能使用 Mithril 的虛擬 CLUSTER 回覆代替。故障後角色可能變動，下一輪要重新核對 replica placement，不盲目套用初始表。

Baseline 固定 cache=no、slave-mode=off、backend-sharding=no。預編譯 binary／容器不要求四台安裝 Rust；source/native tests 則在隔離 builder 執行。Image tag、CPU 架構、來源 commit 與 digest 未核對不得啟動。

只有 runtime evidence 才能更新 MR-004–008。命令成功退出、文件完成或別人的 benchmark 都不能代替功能／故障／效能驗收；非冪等請求逾時要保留 ambiguous，不能一律自動重送。

## 每輪回報與交付

回報當前 MR 任務／P 階段、實際做過的動作、固定版本、測例與數量、結果分類、私有 evidence 位置的安全描述、未完成原因與下一步。更新 STATUS／VALIDATION，不增加第二份 backlog，不把合併 PR 當作部署完成。

以 branch／PR 交付。只有 Owner 對本輪明確要求合併時才合併；核對完整 diff、來源／靜態檢查、適用 CI 與精確 head SHA，合併後再回讀 main 和 PR 狀態。不跳過 required checks，不改 branch protection。
