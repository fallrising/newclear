# fe-review — agent-platform

第 2 輪原批准 DESIGN M1–M3 已完成本機實作與兩次 fresh 隔離實測，待獨立審查及 exact-head CI／合併。`targets.verified=true` 只適用此範圍，不是完整平台或第 3 輪驗收。

- [結果與限制](tasks/round2/report.md)：兩次 complete 各 38 captures／14 steps；早期失敗、native 環境錯誤與 focused 補驗均保留。
- [機器驗證摘要](tasks/round2/verification.json)：114 raw／76 complete captures、hash 與兩次語意一致性。
- [RUNNER](RUNNER.md)：fresh 專用 PostgreSQL、真 FastAPI＋fake backend、兩次順序執行的隔離入口。
- [DESIGN](DESIGN.md)：owner 已確認的原 M1–M3 與未啟動的第 3 輪範圍；原規格保持不變。
- [REVIEW](REVIEW.md)、[PROMPT](PROMPT.md)、[targets](targets.json)：目前狀態、後續驗收與入口。

`runs/<id>/capture.json` 和 isolation receipts 可公開；PNG、auth.storage.json、raw logs ignored。Fixture state 在 checkout 外，以即時合成憑證啟動，不使用既有秘密。補拍明示為 `page.route`，不能冒充真 VM／審批／模型用量。
