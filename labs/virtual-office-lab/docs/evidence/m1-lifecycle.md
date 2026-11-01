# T-0003 命令生命週期驗證

2026-10-31，本機完整 checkout，延續 Draft PR #863。

- `npm run check`：通過，包含 office-run 語法。
- `npm test`：35 passed，0 failed/skipped。真實子程序成功／失敗、環境隔離、起始報告失敗不啟動、結尾報告失敗不回成功、spawn 失敗均覆蓋。
- loopback HTTP：production reporter + handler + 實際子程序，確認 terminal → done、revision 3、命令不在 wire。storage 明示記憶體替身。
- `npx --yes --package=wrangler@4.156.0 -- node tests/workerd-smoke.mjs`：通過。以 content 別名與獨立臨時 token 執行真 `node --check`，由 CLI 經 HTTP 寫入真 workerd／SQLite，讀回 done/revision 2，後續重啟回歸亦通過。
- 首次 runtime 嘗試用了不存在於 roster 的 codex alias，被拒絕且未啟動命令；修正為已登記 content，未放寬驗證。
- 全倉 indexes、50 success contracts、8 llms.txt 與 diff checks 通過。

沒有模型 API、公開部署、瀏覽器或獨立審查；原生 Agent hooks、完整 AC-07 仍 pending。長任務 heartbeat、wrapper 被 kill 後復原尚未實作，見 [使用與限制](../LIFECYCLE.md)。
