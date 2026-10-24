# FE Review — agent-platform — REVIEW

Owner 已於 2026-10-23 確認原 [DESIGN](DESIGN.md)，見[決策紀錄](../../../docs/fe-review/ROUND1-ACCEPTANCE.md#owner-confirmation-20261023)。第 2 輪本機實作與實測已完成，待獨立審查、exact-head CI／正常合併；第 3 輪未啟動。

## 目前證據

[本次報告](tasks/round2/report.md) 與 [verification](tasks/round2/verification.json) 記錄兩次 fresh 專用 PostgreSQL＋真 FastAPI＋fake backend：各 38 captures／14 steps，source hashes 與語意一致。PNG／登入 state／raw logs 不提交。依 [元件 AGENTS](../AGENTS.md) 及 SUCCESS 管理主線，本輪沒有改後端／API／原 fixture／依賴／CI。

- C1／C3：真單一 origin 入口已實測，登入後 view 使用互動 driver；專案、Agent 設定未新增產品 URL。
- C2：fake backend 不支援真 pause／resume／cancel／approval 及模型用量。11 個呈現狀態以明示 API 覆寫補拍；最後移除 routes 後真任務與 1 prompt／1 allocation／100 events 不變。這個後端能力界線仍保留。
- C4：只驗證既有 light，不新增 dark mode。
- C5：最新 `taskLocation.ts` 在本輪前已含 pausing 中文；本次補 App 實際 render regression 與補拍，沒有重複產品修改。
- C6：兩條審批錯誤的 error class、受理 notice class、zh-TW 短時間已修正並有 RED/GREEN 與實拍。

## 保留的失敗與驗證界線

兩次早期 partial capture 的 8／30 張不計入兩次 complete 的 76 張；全部 114 raw 圖片 hash 已核。第一次恢復等待與 Uvicorn 重拋 SIGTERM 的 harness 假設已修正；第二次補拍快取問題以明確 reload 解決。沒有修改產品流程來讓測試過關。

Root 原生 web85 tests／typecheck／format／build通過。Python lint／format165 files、45 unit tests 通過；原 platform641 tests 當次有4個環境errors（Docker CLI／C development headers缺少），原樣保留；對應35 focused host-native tests通過。這是複合證據，不能把原完整命令改寫成 PASS，exact-head full CI 仍待完成。

完成 capture 的 pageerror／document overflow 為0；503 是兩個明示審批錯誤補拍，offline及導航／SSE teardown的網路／console事件保留分類。未跑axe，不宣稱零違規；沒有執行完整第3輪、長事件效能、200%zoom或真VM/provider驗收。

內層 SIGTERM 具有 graceful completion markers，正常及真失敗外層 cleanup 已確認；額外 outer-TERM probe 因競態未正面觀察handler觸發，保持 **inconclusive**，不能稱已驗證。Wrapper兩次完整run之間只移除不適合browserimage的unused native模式，capture邏輯未改，兩份receipt保留實際hash。

## 後續

[PR #588](https://github.com/fallrising/newclear/pull/588) 的獨立審查／exact-head CI／合併由 parent 收尾。`verified: true` 僅代表原 R2 M1–M3；平台 SUCCESS 的 AC-04、usable_tag 與 live gate 不變。本輪沒有新增產品範圍或待批准 UI 修正。
