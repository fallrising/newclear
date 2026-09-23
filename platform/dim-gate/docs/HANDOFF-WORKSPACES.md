# dim-gate 三工作區接手

本文件隨 W3 closeout 更新。**先重新核對 GitHub 與 PLAN，不以本文件的歷史 checkpoint 當成已驗收。** 使用者本輪最新要求是保存進度、依 gate 合併可交付 PR，然後新視窗繼續；目前視窗在 W3 收尾，W4／W5 留待下一輪。

## 接手入口

- Repository: `git@github.com:fallrising/newclear.git`；Git 傳輸只用 SSH。
- Component: `platform/dim-gate/`。
- W3 canonical worktree: `/home/ckc/test/codex/newclear-dim-gate-w3`。
- Branch: `agent/dim-gate/mainline/w3-service-delivery`；沿用 [PR37](https://github.com/fallrising/newclear/pull/37)，禁止另建重複 PR。
- Current run: `DG-W3-20260923-01`；owner／terminal state 以 root [.team/PLAN.md](../../../.team/PLAN.md) 最後一個 dim-gate resume block 和 PR closeout 為準。若 owner 尚未釋放，先對帳，不與其他主控競寫。

依序讀適用 AGENTS.md／AGENTS.override.md、[DEVELOPMENT_PROMPT](../DEVELOPMENT_PROMPT.md)、[DEVELOPMENT_PROTOCOL](DEVELOPMENT_PROTOCOL.md)、PLAN、[STATUS](STATUS.md)、[SDD](../SDD.md)，然後 docs/sdd/09–14。01–08 和既有 integration contracts 是已交付基線，涉及時核對。SDD 完成不等於功能完成。

## 目前固定事實與 pending gates

W1 [PR33](https://github.com/fallrising/newclear/pull/33) 已 ACCEPTED/MERGED，actualmerge `b4ef57f1e15082f3e980b2eb0d8451b1f1f4433d`。W2 [PR36](https://github.com/fallrising/newclear/pull/36) 已 ACCEPTED/MERGED，actualmerge `91626851fb17df7ab31c96dee9353b9ee4d42c92`，component tree 與 accepted head 相同；exactheadCI35846286919、postmergeCI35849832030、mirror35849832043均成功。兩輪 owner 已釋放，不重做有效成果。

W3 初始 source `dfb146c`、normal latestmain merge `a473626`、test/progress checkpoint `31b5c88` 已 SSH 保存。W3 全量領域／API／遷移／UI／新瀏覽器流程已實作，**當前仍 NOT_ACCEPTED**，完整整合回歸、固定版本獨立 review、最新 head CI 與 merge 尚待 closeout。T037 最終32個領域檔已按 SHA 整合並釋放 worker ownership；T038 最終瀏覽器 handback 正在保存。Worker 沒有 commit/push/self-accept。

本輪實測：原始 fixed native357/360 與 CI35854397207 的三項失敗是新增 W3 草稿造成舊筆數預期失效；更新後保留跨團隊私有 ID/name 隔離。原始初始 JS309048 超標；經保留 eager snapshot／遷移／完整性驗證的 schema／command/API 模組分離及 Guide route lazy，最新 working candidate 初始 JS306290bytes、LCP756ms、5000CI query p95 0.7ms、100 persisted HTTPcommands p95 169.8ms，3/3 unchanged benchmark 通過。此 working evidence 必須用最終 fixed candidate 對帳；不能單獨視為 ACCEPTED。

完整 source behavior 依 [W3 contract revision3](W3-INTEGRATION-CONTRACT.md)。T039 [canonical report](../../../.team/reports/T-039.md) 保存後續固定來源與實測；獨立 [T040 report](../../../.team/reports/T-040.md) 最初只是 preliminary contract review，最終產品 review 必須另有明確 fixed commit verdict。

## 直接執行的下一步

```sh
cd /home/ckc/test/codex/newclear-dim-gate-w3
git remote -v
git status --short
git worktree list --porcelain
git fetch origin main
git rev-parse HEAD origin/main
gh pr view 37 --json state,isDraft,headRefOid,mergeCommit,statusCheckRollup,body
```

先看 PLAN 最新 resume。若 W3 尚未合併，沿用 PR37，處理報告中未通過 gate，不跳到 W4。若 W3 已按 gate 合併，核對 actual merge、component tree、CI／owner release 後，從 actual main 建立隔離 W4 branch/worktree/run，分配新的 task ID。所有舊工作樹、dirty files、預覽和分支都保留，不 reset/clean、不 force push、不直接 push main、不刪 worktree。

執行原生命令必須在 component cwd，使用 Node24.18.0/pnpm11.18.0：

```sh
export PATH=/home/ckc/test/codex/.toolchains/node-v24.18.0-linux-x64/bin:$PATH
cd platform/dim-gate
pnpm lint
pnpm typecheck
pnpm test
pnpm check:docs
pnpm check:contracts
pnpm check:ci
pnpm check:architecture
pnpm build --mode demo
pnpm test:e2e
pnpm test:smoke
pnpm benchmark
pnpm test:isolation
```

本機瀏覽器需要以下已存在的測試環境；標準 CI 不依賴這些絕對路徑。使用尚未占用的 port，不能接管既有4173／4214預覽。

```sh
export LD_LIBRARY_PATH=/tmp/dim-gate-m5-webkit-libs/usr/lib/x86_64-linux-gnu:/tmp/dim-gate-playwright-libs/usr/lib/x86_64-linux-gnu
export FONTCONFIG_FILE=/tmp/dim-gate-m3-fonts-kaBaS8/fonts.conf
export DIM_GATE_WEBKIT_EXECUTABLE=/tmp/dim-gate-m5-webkit
export DIM_GATE_TEST_PORT=4350
export DIM_GATE_PERFORMANCE_PORT=4351
```

當前環境的 default sandbox 因 bubblewrap loopback 初始化失敗而不能啟動 shell；本輪命令使用自動審查的 escalated execution。這是工具環境限制，不能因此繞過任何產品 gate。Pinned private kernel237aa277／validator 已讀，驗證器 `/tmp/dim-gate-w1-evidence/teamctl.py` 只在本機使用，不複製進 public repository。Builtin uninvolved reviewer fallback 已披露；exact model slug 未由 runtime 暴露，不聲稱 Claude 或多模型審查。

## 後續完整範圍

W4 依14完整 AC-WS-12/15–18：MonitorPolicy/AlertRule/SLO 固定 schema、服務和基建授權分離、prod independent approval、source-time/ruleRevision evaluation、Silence只抑制通知、不刪 incident/evidence、可查 queued/suppressed/delivered/failed Mock通知，保留既有M4因果鏈。

W5 依14完整 AC-WS-13–18：demo user/team lifecycle且不自動授權／登入、穩定 feature cohort與現行授權交集、registered adapter route診斷及受限失敗 fallback、scope脫敏通知／去重／重試／撤權，不重放舊私有內容。能力地圖「後續／待釐清」不冒充實作。

每個增量先固定 integration contract、需求／AC、task scope、shared owner和驗證，再實作；schema/API/權限/狀態機/持久化同步規格、OpenAPI、Mock、migration和tests。共用 entity IDs、API、state、event和audit，保留Request/Release，不以選單/workspace/flag賦權，Admin沒有隱含業務執行權。真實瀏覽器驗證成功、拒絕、失敗、跨角色一致性與刷新恢復。每里程碑完成未參與實作的唯讀review及最新PRheadCI，才commit/SSHpush/merge與actualcloseout後接下一個。

使用者已持續授權隔離branch/worktree、commit、SSHpush、建立／更新PR，以及對應驗收/review/latestheadCI全部通過後合併；不需每輪再問。未授權部署、真雲端、外部通知或真憑證。本機 `/tmp` 原始 log/PNG 不能冒充跨機器 durability；版本化摘要與 GitHub CI artifact/URL 必須保留，artifact有到期日。

## 新視窗可直接貼上

```text
請接手 dim-gate，先讀 /home/ckc/test/codex/newclear-dim-gate-w3/platform/dim-gate/docs/HANDOFF-WORKSPACES.md，並依適用 AGENTS、DEVELOPMENT_PROMPT／PROTOCOL、root .team/PLAN.md 最新 dim-gate resume、STATUS、SDD 與 docs/sdd/09–14 重新對帳 Git／worktrees／PR／CI／active owner。沿用 PR37 若 W3 尚未按 gate 合併；W3 若已驗收合併且 owner 已釋放，從 actual main 開隔離 W4 run，持續完成 W4、W5。不要重做有效的 W1/W2/W3 成果，不跳過剩餘 gate。每里程碑實作、完整驗證、獨立唯讀 review、commit、SSH push、PR、最新 head CI 通過與合併／actual closeout 後，再接下一個。上述 GitHub 授權持續有效，不需要逐次確認。保留所有既有 worktrees/dirty files，不 force/main push、不部署、不操作真雲端／外部通知／真憑證。每重要 checkpoint 更新 PLAN、task/attempt/canonical reports、STATUS、PR 與 handoff。
```
