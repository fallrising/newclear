# 開發交接

最新單次批准已使用：240 秒期限下於 34.05 秒因第二個 Read 被邊界拒絕而停止，沒有產物；session／固定模型／hooks 有證據，清理完整。第二次讀取的目標未記錄，不能確認它是否為輸出檢查。已離線準備最多四次工具規則、預建空 result.json 與檔案分類診斷；65 tests 和無 prompt 啟動通過，尚未再次跑模型。[本輪證據](docs/evidence/cursor-bounded-2026-11-01.json)。AC-13 保持 pending、PR #878 保持 draft；下一次付費任務須新批准。

T-0009-02 前次紀錄：owner 已批准且執行一次 Composer 2.5 任務，產物正確，但 lab 的 stop.loop_limit=0 讓原生 CLI 拒絕整份 hooks，沒有事件／用量／工具邊界證據，AC-13 未通過。[失敗及修正證據](docs/evidence/cursor-live-2026-11-01.json)。已停止並完整清理，未追加付費重跑。已改 loop_limit=1、仍不返回 followup_message；修正合法 beforeReadFile，並在 wrapper 增加固定 CLI 內純 schema validator 的實際預檢。63 tests、原生設定預檢與修正後無 prompt 啟動通過。PR #878 保持 draft，這次授權已使用；再執行 `--allow-remote` 必須得到 owner 的新批准，範圍及無金額硬上限見 [CURSOR-WORK](docs/CURSOR-WORK.md)。

T-0009-02 先前準備紀錄：owner 已登入；原生 status authenticated、catalog 有 composer-2.5。已準備[一次有界任務](docs/CURSOR-WORK.md)，63 項離線測試與已登入無 prompt 啟動通過；[證據](docs/evidence/cursor-ready-2026-11-01.json)。完全斷網啟動曾回 internal error，允許 HTTPS metadata 後進入 Composer 2.5 待命畫面。沒有執行模型 prompt；等 owner 明確批准一次 120 秒／最多兩個工具的配額驗收。Cursor 不提供 runner 可保證的 request／token／金額硬上限；停止本機也不等於即時停止服務端計費。取得批准後執行 `python3 scripts/run_cursor_work.py --allow-remote` 一次，保留失敗，不自動重跑；AC-13 仍 pending，功能 PR 保持 draft，驗收後才合併與結案。

T-0009 依 owner 要求新增 Cursor Agent 第四工位：固定官方 2026.10.22-27dcf5f、archive／runtime 摘要核對、隔離 HOME／CURSOR_CONFIG_DIR／file credential store、原生 Office PTY 與 workspace hooks。無憑證啟動 12.51 秒通過，hooks 安裝／移除、外部 TCP 拒絕與 5 個追蹤程序清理正確；55 項離線測試通過。[證據](docs/evidence/cursor-startup-2026-11-01.json)、[owner 登入命令](docs/CURSOR.md)。需 owner 自行 `python3 scripts/cursor_cli.py login`；未登入不是執行失敗，也沒有驗證 session hook／模型／任務。新增 AC-13，完整目標擴為四工位，保持單 run queue。下一步補有界 Cursor／Grok 真實任務；登入不代表付費授權，不重跑已通過的 Pi 任務。

T-0008 已加入 Grok 無憑證啟動 runner：官方 1.0.70 進入原生登入畫面、Office needs_input、OS 拒絕外部 TCP、PTY 與額外背景程序清理通過，12.83 秒。47 項離線測試通過；[證據](docs/evidence/grok-startup-2026-11-01.json)、[命令及限制](docs/GROK-STARTUP.md)。故意不讀 owner auth；這不是登入失效，也沒有發出模型任務。第一次等 SessionStart 超時，後續以原生登入畫面＋needs_input 驗證未登入狀態，未把它算成 session／任務成功。下一步建立登入後的有界 Grok 任務 runner、工具與請求限制，再請 owner 確認具體的配額／付費驗收；尚無可直接執行的遠端命令。

T-0007 的 Pi + DeepSeek 原生工位實測通過（AC-04）：owner 明確授權一次有界付費驗收，3 次 HTTP 200 請求，2147 input／204 output tokens，22.62 秒，agent_settled、session/model、read/write、產物 hash 與清理全部通過。[真實證據](docs/evidence/pi-live-2026-11-01.json)與[命令／限制](docs/PI-REMOTE.md)。41 項離線測試與零請求啟動也通過。此次授權已使用，不代表可再做付費重跑或 Grok 任務；下一步是 Grok 與剩餘 MVP，原 local-only demo 不變。

T-0006 已準備官方 Grok Build 1.0.70／Pi 1.4.0 的 lab 內固定安裝、真實 CLI 版本與能力 probe、隔離 owner 登入設定入口；35 項離線測試通過。見[owner 命令](docs/REMOTE-SETUP.md)與[白名單證據](docs/evidence/remote-preflight-2026-11-01.json)。本輪沒有遠端模型請求，沒有重啟 Strata；需要 owner 完成 DeepSeek key／Grok 登入後，再接實際遠端 worker 與合成任務。不得把 CLI compatible 或合成金鑰格式解析當成 auth／推論通過。

T-0005 的 OpenCode host crash／interrupted／手動恢復已完成真實驗收：四個獨立 host，舊 PTY 全退出、重複重啟不執行、lite 可見中斷、點開工位接回同 session 完成、完成後重啟不重跑。91.22 秒；既有生命週期回歸 62.96 秒通過，26 項離線測試通過；[證據及三次先前失敗](docs/evidence/restart.md)。adapter 依賴固定上游內部介面，沒有修改 vendor。完整三 provider AC-08 仍 pending。

目前已有 Codex → Strata 本地讀寫與合成程式修復、Office 基底建置／614 tests，以及原生 Office → OpenCode → Strata 的檔案任務、同 session 後續任務取消與程序清理。這些是 2026-10-31 的歷史實測，[摘要與限制](docs/evidence/README.md) 保留成功及失敗範圍。同 session 續做不等於真正 restart/resume。

下一步接官方 Grok Build 的有界任務，再補三工位流程與其餘生命週期；Pi + DeepSeek 的 AC-04 已通過，OpenCode 的權限、refresh、程序恢復與 host 重啟子集已有實測。官方 Grok 的隔離登入檔已存在，但尚未發出模型任務；遠端服務須顯式選擇，不可替私人任務自動 fallback。最後整合三工位入口、產物、錯誤、取消與安全邊界。

依 [SETUP](docs/SETUP.md) 準備環境；`STRATA_HOME` 指向外部本機 Strata 根目錄。32K context、現有 Q2_0 量化及資源 guard 不任意變更。不要同時載入另一個大型模型、取消全部 sandbox、修改全域憑證，或將 mock 當成 live 證據。

公開匯入只調整路徑選擇與內附監控腳本；舊 runs 保留於原工作區，沒有上傳。新增驗收先記本次範圍與 AC，最後補精簡公開證據。不要為確認相同歷史結果重跑昂貴推論；runtime 有相關變更才做針對性回歸。
