# 單人使用版：mock 預算與故障驗收

目前先完成本機 mock 的控制流程。真 API、可信帳單與硬金額上限延後；它們不作為單人 mock 切片的完成條件。此選擇不將合成 credits、公開價目 preview 或 mock token counters 升格為帳單。`cost_status: unknown`、`amount_decimal: null`、`hard_money_limit_supported: false` 保持原樣。

## 控制範圍

- OpenAI 相容 loopback mock 使用 pinned request cap。八個同時請求在 cap=2 時只允許兩次上游 dispatch，另外六個被拒絕。
- 不合法 mock usage 保留 unknown request slot；相同 request ID 不重送。Token 輪替與重新建立 proxy 不重設額度，也不能改已釘住的 model／policy。
- 固定 fixture 的合成 credits 在上游 I/O 前預留。429 後保留完整預留；token 輪替與重新建立 proxy 後仍不退款、不重送、不容許越額的新 dispatch。這只是一個受控合成計量契約，不適用於 compatible mock／HTTPS provider 的真實帳單。
- 真實 HTTP proxy 程序重啟後，SQL ledger 仍保存 request cap；新的 request ID 也無法越過已耗盡的限制。
- 既有 durable cutoff 撤銷 token，保留 VM reservation，直到完整停止證據核對成功。SQL fixture 的驗收不代表本次啟動或停止過真實 VM。

來源：`tests_platform/test_guest_model.py` 的 `MockTransportTests` 與 `tests_platform/test_model_proxy.py` 的 `ModelProxyTests`；本輪 `make platform-check` 通過 Ruff、45 項 unit tests 與 214 項 PostgreSQL／HTTP tests（沒有 skipped）；四項 targeted regressions 亦通過。完整結果見 [本輪證據](evidence/m3-single-operator-2026-10-03.json)。

## 使用與驗證

沿用 [本機 mock](M3-OPENAI-MOCK.md) 的私有設定與 request_limit，以及 [fixture credits](M3-FIXTURE-BUDGET.md) 的可選合成額度。沒有增加 configuration 欄位、migration、依賴或新服務。可使用 `make platform-check` 跑 SQL／HTTP／故障注入檢查；真實 KVM／provider 是獨立 opt-in 驗收。

## 完成範圍與後續

本輪只驗收單人 mock 的請求／額度與故障語意。M3 整體仍為 In progress；完整 AT-07（包含 artifact XSS）及跨切片整合尚未結束。既有隔離／網路 KVM 證據保留歷史範圍，本輪沒有重新執行 KVM。

M4 的結果封存、export、backup／GC 與部署手冊仍未開始。沒有付費 provider、可信計費保證或 24 小時停留驗收；Agent Computer 的可見桌面是獨立實驗，不因本輪 mock 結果而變成已實作。
