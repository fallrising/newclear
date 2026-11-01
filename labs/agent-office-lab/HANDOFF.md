# 開發交接

T-0013：新派工入口的 OpenCode／Strata 真實本地任務與原生取消通過。最終 runner 整輪任務／取消驗收 54.95 秒、產物 hash 正確；原生取消與所屬程序退出 202 ms，全程追蹤 60 個程序，最後全部退出。另一次原生 working 後 Ctrl+C 正確顯示 cancelled／exit 130，10.399 秒後追蹤到的 23 個程序（含 runner）全部退出；這包含模型關閉，不是工位取消耗時。三次實測均拒絕重複派工、釋放執行鎖，資源 guard 未觸發，沒有遠端模型呼叫。122 tests 與 36 筆結果的瀏覽器篩選／產物／刷新通過。[證據](docs/evidence/local-dispatch-2026-11-01.json)，[操作](docs/DISPATCH.md)，交付狀態見[任務板](docs/tasks/BOARD.md)。遠端 provider 的新入口與取消／恢復仍待驗，完整 MVP 保持 incomplete。

T-0012：新增[統一偵測與派工入口](docs/DISPATCH.md)。四個固定 CLI 的實際斷網版本／help 檢查通過；run 預設只顯示計畫，遠端執行須明示 execute 與 allow-remote。四個直接 runner 共用執行鎖，跨 exec 保留，清理未確認或強制中斷會阻擋下一次派工；不自動重試。117 項離線測試通過。本輪沒有新模型呼叫或啟動 Strata，完整派工到產物與跨 provider 生命週期尚未重驗。[證據](docs/evidence/dispatch-2026-11-01.json)，交付狀態見[任務板](docs/tasks/BOARD.md)。

T-0011：新增[統一結果入口](docs/RESULTS.md)，以白名單回讀四 provider 原生紀錄、重新核對合成產物內容與 SHA-256，提供離線篩選與詳細頁。96 項離線測試通過，既有 33 筆 run 回讀保留成功／失敗／啟動檢查／未完成區別，四 provider 各有成功產物通過重驗；Chrome 篩選、詳細內容、刷新通過，零外部請求。沒有新增模型呼叫或重啟 Strata。[本輪證據](docs/evidence/results-console-2026-11-01.json)。完整 AC-09／AC-11 保持 pending；下一步仍是統一偵測／派工與跨 provider 生命週期。交付狀態見[任務板](docs/tasks/BOARD.md)。

T-0010 最新：owner 再批准一次翻倍範圍後，Grok 1.0.70／grok-4.6 真實任務通過 AC-03，18.00 秒完成兩個 read_file 與一個 search_replace；同 session 模型、authenticated hooks、成功工具結果、end_turn Stop、精確產物 hash 與清理一致。[成功證據](docs/evidence/grok-completed-2026-11-01.json)。81 項離線測試通過；先前失敗保留，本次授權已使用、沒有自動重跑。交付及結案狀態見[任務板](docs/tasks/BOARD.md)。四 provider 各有合成任務證據，但統一產品流程、權限／取消／恢復及完整 MVP 尚未完成。

以下為歷史交接；等待批准／draft 描述是當時狀態，以任務板最新紀錄為準。

T-0010 的一次已授權 Grok 任務已執行，12.55 秒後因 lab 只識別 file_path、未識別原生 read_file 的 target_file 而停止；兩次讀取請求被拒，seed output 未變，AC-03 未通過。原生 session／模型／prompt 正確，程序與憑證副本清理完整。[失敗與離線修正](docs/evidence/grok-live-2026-11-01.json)：已支援無歧義路徑別名、兩檔並行讀取、按 tool ID 核對完成，保留四次工具 gate／唯一編輯；80 tests 通過。沒有追加付費重跑；PR #897 保持 draft，等新的單次批准。

T-0010 已準備 Grok 1.0.70／grok-4.6 單任務 runner：原生 inspect 確認 hooks、已登入無 prompt 啟動與同 session 模型選擇、清理通過（12.52 秒）；78 項離線測試通過。[證據](docs/evidence/grok-ready-2026-11-01.json)、[單次範圍](docs/GROK-WORK.md)。沒有送模型 prompt；AC-03 仍 pending，等 owner 明確批准一次付費驗收。四工具 hook gate 會受原生 fail-open 行為限制，沒有 request／token／金額硬上限。

T-0009-02 的第三次獨立授權任務通過 AC-13：Composer 2.5，15.57 秒，Read(input) → Read(result) → Write(result)，原生同 session／model、completed stop、37723 input／424 output tokens、精確產物 hash 與完整清理一致。[成功證據](docs/evidence/cursor-completed-2026-11-01.json)。前兩次失敗保留；本次授權已使用，沒有自動重跑。65 項離線測試通過；PR #878 待 CI／合併，完整 MVP 仍 incomplete。

前次單次批准紀錄：240 秒期限下於 34.05 秒因第二個 Read 被邊界拒絕而停止，沒有產物；session／固定模型／hooks 有證據，清理完整。第二次讀取的目標未記錄，不能確認它是否為輸出檢查。已離線準備最多四次工具規則、預建空 result.json 與檔案分類診斷；65 tests 和無 prompt 啟動通過，尚未再次跑模型。[本輪證據](docs/evidence/cursor-bounded-2026-11-01.json)。AC-13 保持 pending、PR #878 保持 draft；下一次付費任務須新批准。

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
