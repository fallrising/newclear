# 開發交接

先讀 [SUCCESS](SUCCESS.md)、[SDD](docs/SDD.md)、[任務板](docs/tasks/BOARD.md)。canonical 位置是 `fallrising/newclear` 的 `labs/agent-office-lab`。

T-0006 已準備官方 Grok Build 1.0.70／Pi 1.4.0 的 lab 內固定安裝、真實 CLI 版本與能力 probe、隔離 owner 登入設定入口；35 項離線測試通過。見[owner 命令](docs/REMOTE-SETUP.md)與[白名單證據](docs/evidence/remote-preflight-2026-11-01.json)。本輪沒有遠端模型請求，沒有重啟 Strata；需要 owner 完成 DeepSeek key／Grok 登入後，再接實際遠端 worker 與合成任務。不得把 CLI compatible 或合成金鑰格式解析當成 auth／推論通過。

T-0005 的 OpenCode host crash／interrupted／手動恢復已完成真實驗收：四個獨立 host，舊 PTY 全退出、重複重啟不執行、lite 可見中斷、點開工位接回同 session 完成、完成後重啟不重跑。91.22 秒；既有生命週期回歸 62.96 秒通過，26 項離線測試通過；[證據及三次先前失敗](docs/evidence/restart.md)。adapter 依賴固定上游內部介面，沒有修改 vendor。完整三 provider AC-08 仍 pending。

目前已有 Codex → Strata 本地讀寫與合成程式修復、Office 基底建置／614 tests，以及原生 Office → OpenCode → Strata 的檔案任務、同 session 後續任務取消與程序清理。這些是 2026-10-31 的歷史實測，[摘要與限制](docs/evidence/README.md) 保留成功及失敗範圍。同 session 續做不等於真正 restart/resume。

下一步先確認 Grok CLI 版別與偵測能力，再接 Grok 與 Pi + DeepSeek；OpenCode 的權限、refresh、程序恢復與 host 重啟子集已有實測。Grok 官方／社群版身分仍待確認；遠端服務須顯式選擇，不可替私人任務自動 fallback。最後整合三工位入口、產物、錯誤、取消與安全邊界。

依 [SETUP](docs/SETUP.md) 準備環境；`STRATA_HOME` 指向外部本機 Strata 根目錄。32K context、現有 Q2_0 量化及資源 guard 不任意變更。不要同時載入另一個大型模型、取消全部 sandbox、修改全域憑證，或將 mock 當成 live 證據。

公開匯入只調整路徑選擇與內附監控腳本；舊 runs 保留於原工作區，沒有上傳。新增驗收先記本次範圍與 AC，最後補精簡公開證據。不要為確認相同歷史結果重跑昂貴推論；runtime 有相關變更才做針對性回歸。
