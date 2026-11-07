# T-0002：M1 持久化回歸補強

2026-10-31，本機完整 checkout，工作分支 `feat/virtual-office-persistence`。

## 實際執行

- `npm run check`：通過。
- `npm test`：28 passed，0 failed/skipped。
- `npx --yes --package=wrangler@4.156.0 -- node tests/workerd-smoke.mjs`：通過。真 local workerd + SQLite，非記憶體替身，未建立遠端資源。
- 根目錄 `python3 scripts/check_indexes.py`：50 個 success contracts、8 個 llms.txt，0 error。
- `python3 scripts/check_project_success.py`、`git diff --check`：通過。

## 新增覆蓋

同 revision 併發僅一筆成功。把接受更新填滿至 revision 12、確認 429，再停止整個 Wrangler process group，以同一 SQLite 目錄重啟。確認 revision／reportedStatus／lastSeen 保留；第一筆 event 的完全重送仍為 200，同 ID 改內容為 409，新 event 為 429 且 Retry-After > 0。最後確認公開 bots 完全未變。

測試等候真實固定分鐘邊界，預留整個窗口執行，並明確 assert 未跨分鐘；慢主機跨窗會報錯而非假通過。最多額外等待約 60 秒。啟動／結束仍使用臨時隨機憑證與臨時 SQLite，finally 清理。

## 邊界

這是 AC-03 的新增真 runtime 證據，不是完整 M1：尚未完成真 Agent lifecycle hook、瀏覽器、公開部署、跨版本 migration、備份復原或獨立審查。未修改 production runtime，未呼叫模型。保留 `mainline: incomplete`、`usable_tag: none`。依元件停止條件交付 Draft PR，不自動合併。
