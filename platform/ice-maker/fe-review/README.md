# fe-review — ice-maker

已實作並實測原批准 R2 M1–M4：合成啟動器、內嵌上傳頁、錯誤與輪詢處理、結果頁外殼。必要 browser 證據已齊；獨立審查、exact-head CI 與合併由 root 收尾。第3輪完整驗收與產品 AC-04 未宣稱完成。

| 入口 | 用途 |
| --- | --- |
| [本次報告](tasks/round2/report.md) / [result.json](tasks/round2/result.json) | 實際命令、結果、原失敗與補證、來源 hashes |
| [RUNNER.md](RUNNER.md) | 原生檢查與隔離 capture 介面 |
| [PROMPT.md](PROMPT.md) / [REVIEW.md](REVIEW.md) | 工作範圍與現況 |
| [targets.json](targets.json) | 已實測的 upload／short-result／long-result 路由 |
| [DESIGN.md](DESIGN.md) | 已批准 M1–M4；僅補明確30分鐘 UI poll cap |

公開 evidence 只含合成文字與 JSON；PNG、raw logs 與服務 state 留在 ignored 本機目錄。共用規範：[PROTOCOL.md](../../../docs/fe-review/PROTOCOL.md)。
