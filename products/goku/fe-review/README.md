# fe-review — goku

原批准 R2 M1–M3 已實作，store 回歸與原生 lint/build 通過。隔離 json-server 的主要流程已實測；最後 favicon 解碼補證已通過；M1 staged tracking 已確認，獨立審查與 current CI／merge 仍待收尾。不是完整第3輪或產品主線驗收。

| 入口 | 用途 |
| --- | --- |
| [本次報告](tasks/round2/report.md) | 實測結果、原失敗、已知限制 |
| [RUNNER.md](RUNNER.md) | 無新依賴 focused checks 與 owned runtime 介面 |
| [PROMPT.md](PROMPT.md) / [REVIEW.md](REVIEW.md) | 批准範圍與目前狀態 |
| [targets.json](targets.json) | 真 loopback fixture 入口；僅原 R2 的隔離瀏覽器入口已實測 |
| [DESIGN.md](DESIGN.md) | 原批准 M1–M3，保持不變 |

原始 PNG／logs／DB 只留 ignored 私有目錄。公開 evidence 只含合成文字與去敏結果。共用規範：[PROTOCOL.md](../../../docs/fe-review/PROTOCOL.md)。
