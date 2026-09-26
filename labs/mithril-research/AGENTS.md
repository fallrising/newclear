# Mithril research: agent instructions

Scope: `fallrising/newclear/labs/mithril-research/`.

先完整讀取 README、`upstream.lock.json`、`docs/STATUS.md`、`docs/RESEARCH.md`、`docs/SDD.md`、`docs/SOURCES.md`、`docs/VALIDATION.md`、`docs/quickstart.md`、`docs/FOUR-NODE-PLAN.md`、`docs/EXECUTION_PROMPT.md`；再讀 root README、PORTFOLIO、taxonomy、portfolio-doc-tiers 及 monorepo-ci 規範。超過輸出限制就分段續讀，不只讀搜尋片段。

## 接手契約

1. 先確認 main、相關 PR／branch 與未提交工作，防止重複建項。保留研究 lock；不將新 upstream master 內容混入舊結論。
2. STATUS 是唯一任務狀態帳。先做最早未完成任務；只有實際 evidence 可使 runtime 任務變成 DONE。四機計劃的 P0–P6 只是程序階段。
3. 區分 SOURCE、UPSTREAM-CLAIM、INFERENCE／DESIGN、LOCAL-RUN；未執行寫 SKIPPED／NO RESULT，不把上游測試或文檔檢查寫成 runtime PASS。
4. Owner 在 2026-09-27 確認四台測試機並要求文檔／PR 合併；本輪不授權部署、故障、清理或主機變更。不得自動使用 Eru、Proxmox VM 或既有 Redis；先核對 H1–H4 身分與保留清單。
5. 未來實機操作只消費已批准的精確 plan／run 範圍；批准範圍內不逐命令重複確認。身分不符、共享服務異常、越界或新風險即停止。故障注入、purge、host runtime／網路變更須明確列入批准。
6. 不把研究擴成 Mithril 重寫或 control plane。snail 保持分級，不搬上游程式碼，不修改 kernel／Eru／知識庫。不提交真實 IP、SSH alias、金鑰、密碼、dump、inventory 或 raw evidence。
7. 若新增 harness，先補測試，再依 root CI 規範建立 path-scoped、read-only、無 secrets／VPS 部署的 workflow。不建立 nested workflow 假裝 monorepo 會執行。
8. 每輪更新 STATUS、VALIDATION 與必要來源；以 branch／PR 交付。不 force-push main，不繞過 required checks。只有 Owner 對本輪明確要求合併時才合併，之後回讀 PR/main 再報結果。

## 下一輪入口

MR-004 / P0：依四機計劃先盤點與映射，再確認 artifacts／網路／資源／回復與操作批准。預編譯 binary／容器不要求每台安裝 Rust；source/native checks 在隔離 builder。需要的 Compose、runtime lock、lifecycle CLI 與實機 evidence 尚未交付，不得宣稱已有可執行 up/smoke/down。
