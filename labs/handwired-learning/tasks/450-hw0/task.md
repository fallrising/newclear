# HW-0：固定上游 API 支援表

Session: Handwired-20261021-1808
Issue: https://github.com/fallrising/newclear/issues/450
PR: https://github.com/fallrising/newclear/pull/452

範圍：SDD §3、§7 HW-0 / SUCCESS AC-01；固定上游 257856e3b221140acb4cc4460626b850c0bd4ff1，API 支援表、最小 CPU 範例與測試、載入及授權證據。
可改：labs/handwired-learning 除 AGENTS.md；本 session 的 .team 計畫、task/report；必要的專用 CI。
排除：HW-1 前向網頁、HW-2 學習區、HW-3 真人試用；上游源碼 vendoring、依賴安裝、GPU、部署與付費 API。

驗收：可重跑的真實上游 CPU 範例；明確判定梯度可用性；固定公式與允差。不得以 mock 或自行公式冒充上游結果。
驗證：Node built-in tests；upstream source pin/digest；python3 scripts/check_project_success.py；python3 -m unittest discover -s scripts/tests -p test_project_success.py -v；python3 .github/scripts/validate_llms_txt.py；git diff --check。所有 build/test 經 agent-workspace launcher。最終 head CI 全綠與不同模型家族唯讀審查後才 merge。
