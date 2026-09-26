# Mithril research: agent instructions

Scope: `fallrising/newclear/labs/mithril-research/`.

先完整讀取本目錄 README、`upstream.lock.json`、`docs/STATUS.md`、`docs/RESEARCH.md`、`docs/SDD.md`、`docs/SOURCES.md`、`docs/VALIDATION.md`、`docs/quickstart.md`；再讀 root README、PORTFOLIO、taxonomy、portfolio-doc-tiers 及 monorepo-ci 規範。不要只讀搜尋片段。

## 接手契約

1. 先確認 GitHub 的 main、工作 branch 與相關 PR，防止重複建項。研究基線由 lock 指定；不能把 upstream master 的新內容混入舊結論。
2. 按 STATUS 的固定編號選取最早未完成任務。只有實際 evidence 可使任務變成 DONE；文件完成不等於 runtime 通過。
3. 文件區分 SOURCE（原始碼核對）、UPSTREAM-CLAIM（作者文件／測試報告）、INFERENCE（研究推論）、LOCAL-RUN（實際執行）。未跑的測試寫 SKIPPED／NO RESULT，不寫 PASS。
4. 真實主機部署、故障注入、清空資料、kernel/fleet 整合與上游程式碼搬入都不在本次授權內。僅使用另行確認的 disposable fixture；不要自動重用 Eru VPS、Proxmox VM 或既有 Redis。
5. 不讓研究變成 Mithril 重寫或新 control plane。`systems/snail` 保持原投資分級；本目錄只能比較其公開文件。
6. 若新增可執行 harness，先補本項目測試，再按 root CI 規範建立 path-scoped、read-only、無 secrets／部署的 workflow。不要建立 nested workflow 假裝它會被 monorepo 執行。
7. 每輪更新 STATUS、VALIDATION 與必要的來源記錄；以 branch／PR 交付，不自行合併或 force-push main。PR 是否合併是獨立事件，不可提前寫成 merged。

## 下一輪入口

先做 `MR-004`：在獨立 Linux 工作環境解析所有 image digest、建置固定 commit，並交付可建立／停止／精確清理的 3-master/3-replica 測試 fixture。任何環境不足都保留為明示阻塞；不可把上游 98-test 聲明當作本地驗證。
