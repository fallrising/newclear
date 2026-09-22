# dim-gate M5 接手 prompt

將下方區塊貼到新 chat。這是開發交接，不表示已部署或已完成 M5；先核對 Git/PR/CI 與 PLAN 的最新 M4 resume block。

```text
請接手 dim-gate，繼續實際開發最早未驗收的 M5，執行真實瀏覽器驗證，不要只提計畫。

Repository: git@github.com:fallrising/newclear.git
目前 M4 worktree: /home/ckc/test/codex/newclear-m4
Component: platform/dim-gate
目前 branch: agent/dim-gate/mainline/m4-observability
M4 product/test candidate: 93a4bbc8cafe03588ff8ef12014eeb2523a93de3
M4 PR: https://github.com/fallrising/newclear/pull/20
M3 parent PR: https://github.com/fallrising/newclear/pull/17

先核對 SSH remote、HEAD、dirty state、owner、所有 worktrees、最新 main、既有 PR 與最新 head CI。Git 傳輸只用 SSH。保留 source、M1/M2/M3、所有 worker 與固定 review worktrees；不可覆寫既有修改。M4 是 stacked PR，先查 parent/merge 狀態再選 M5 lineage；沿用或建立隔離的 M5 worktree，避免誤改已驗收版本。

讀取沿途 AGENTS.md/AGENTS.override.md、component DEVELOPMENT_PROMPT.md、docs/DEVELOPMENT_PROTOCOL.md、root .team/PLAN.md（以最後 M4 resume block 為準）、docs/STATUS.md、docs/M4-INTEGRATION-CONTRACT.md、T-021～T-024 tasks/canonical/attempt reports，以及全部相關 SDD，尤其05效能條件與07AC26–30。確認 M4 最終 metadata-head CI 和 owner release 已記錄在 PR20；如果仍有未完成 gate，先收尾 M4，不能只根據此 prompt 宣稱已驗收。

目前 M0/M1/M2 ACCEPTED且MERGED。M3 ACCEPTED，產品04d6646、metadata7d20bbc，PR17於交接時未合併。M4 已完成 metrics/trace/log/incident、版本化認領調查、去重/重開、回滾後1/2/3健康樣本、integrations、notifications、Guide八步同因果鏈。讀取跨中心診斷 detail 依 action/scope；中心清單與寫入仍受限制。舊 M3 snapshot 要明確 recovery，不得靜默覆寫。

先確認 M4 canonical evidence，再開始 M5：
1. AC26：完整主線 keyboard-only、forms/dialog focus/Tab/Escape/return、topology替代列表、明暗主題axe serious/critical=0，保留實際DOM/screenshots/network證據。
2. AC27：按SDD05量測，不以最快一次報告。現有demoJSgzip465.01kB，需讓初始必要JS≤300KiB；依實際bundle拆lazy modules。1440x900、4xCPU、coldnavigation5次中位LCP≤2.5s；5000CI唯讀profile100次queryp95≤150ms（排除固定mocklatency）；baseline100安全commandsmutationp95≤500ms（包含150mslatency）。記錄CPU/OS/browser。
3. AC28：進行中job reload/resume、storagequota、損壞snapshot、1000command上限，驗證原子性、原始損壞bytes保留、無幽靈工作與可用reset。
4. AC29：/dim-gate/production deep refresh、MSW app-only scope、其他app不被攔截；live mode明示未提供，不可暗中fallback。
5. 加Firefox/WebKit shell與主線smoke；若環境不支援，明示未驗，不冒稱通過。
6. AC30：三provider可重演Guide、使用說明、commit/test輸出、主要頁面截圖或錄影及已知限制。沿用已有47Chromium regression，不重做已驗收業務。

鎖定 Node24.18.0/pnpm11.18.0；pnpm一定從component目錄啟動，root Corepack會選不同版本。先 frozen install、重建demo，不能使用來源不明的舊dist。完整gates:lint,typecheck,test,check:docs,check:contracts,check:ci,check:architecture,build --mode demo,test:e2e,actionlint,git diff --check，再加M5benchmark/extra-browser。

環境內獨立唯讀reviewer必須未參與實作；外部Claude原始碼傳輸先前被環境拒絕，不得繞過。kernel來源固定237aa277b0d067f65c8f64f49c6854597f7f8b15，/tmp/dim-gate-m3-kernel-ykJiGn/repo；按入口核對可用來源與路由，不能猜模型ID。新run按協定建立task、有限scope與預算，只有主控更新PLAN/commit/SSHpush/PR。未全部gate通過不標ACCEPTED或可展示v0.1。

保存PLAN/STATUS/attempt/canonicalreports與獨立固定commit review，SSHpush開發branch，沿用既有PR並等待最新headCI。不得forcepush、直接寫main、自動merge、部署或操作真實雲端。
```

## 這台機器的驗證 runtime

從 `platform/dim-gate` 執行，process-local 設定，不修改全域環境：

```sh
export PATH=/home/ckc/test/codex/.toolchains/node-v24.18.0-linux-x64/bin:/usr/local/bin:/usr/bin:/bin
export LD_LIBRARY_PATH=/tmp/dim-gate-playwright-libs/usr/lib/x86_64-linux-gnu
export FONTCONFIG_FILE=/tmp/dim-gate-m3-fonts-kaBaS8/fonts.conf
```

Playwright1.63／Chromium153.0.8010.12 rev1243。actionlint為 `/tmp/dim-gate-actionlint/actionlint`，workflow在repository root。完整runner `/tmp/dim-gate-m4-evidence/run-gates.py` 與 artifacts 是local-only；跨機器請從PR CI artifacts取得，並重新準備環境。4173 preview須確認空閒，Playwright配置禁止reuse既有server。

M4歷史失敗與修正保留於reports；最終browser證據詳見T-024。原始HTTP拒絕與舊身分回應都保留，不能用全面忽略409或任意sleep替代測試。三provider成功業務轉移都由可見UI觸發，禁止直接修改store偽造成功。
