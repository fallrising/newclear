# HW-2 任務

Session Handwired-20261022-0411 · Refs #465 · PR #466。

只交付 AC-03 / HW-A03～A05（[SDD](../../docs/SDD.md) §5、§8），沿用 HW-1 真實上游與離線 build。T-903 worker 僅寫指定程式與測試；root 擁有整合、文件、CI 與 [任務板](../../docs/tasks/BOARD.md)。無新依賴、HW-3 真人代答、部署或 usable tag。

驗證：先 RED，再固定上游梯度對照獨立解析式、九點 lr0.05/500步、lr2 失敗停止、重設與前向驗證不變；root 重跑完整 Node suites、真實 Chromium、project-success/其 unit tests、llms、task/report validators、diff/link checks。最終 head CI 全綠、不同家族唯讀審查、同步 main、指定 SHA merge 與回讀後才完成。技術任務板在後續 board-only PR 補實際 merge 時間。
