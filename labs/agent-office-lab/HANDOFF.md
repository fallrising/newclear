# 開發交接

先讀 [SUCCESS](SUCCESS.md)、[SDD](docs/SDD.md)、[任務板](docs/tasks/BOARD.md)。canonical 位置是 `fallrising/newclear` 的 `labs/agent-office-lab`。

T-0004 的 OpenCode 寫入權限等待／Allow once 回覆、真瀏覽器刷新不重跑、新程序恢復同一 session 與第二個產物已實測通過（64.30 秒，pressure level 1，清理成功）。15 項離線測試通過；[證據與先前失敗](docs/evidence/lifecycle.md) 已保存。下一步是 Office host 重啟的 interrupted／手動恢復語意；上游自動 wakeAll 尚不符合契約，勿宣稱 AC-08 全通過。

目前已有 Codex → Strata 本地讀寫與合成程式修復、Office 基底建置／614 tests，以及原生 Office → OpenCode → Strata 的檔案任務、同 session 後續任務取消與程序清理。這些是 2026-10-31 的歷史實測，[摘要與限制](docs/evidence/README.md) 保留成功及失敗範圍。同 session 續做不等於真正 restart/resume。

下一步依序補 OpenCode 權限等待／回覆、session resume／browser refresh／host restart，再接 Grok 與 Pi + DeepSeek。Grok 官方／社群版身分仍待確認；遠端服務須顯式選擇，不可替私人任務自動 fallback。最後整合三工位入口、產物、錯誤、取消與安全邊界。

依 [SETUP](docs/SETUP.md) 準備環境；`STRATA_HOME` 指向外部本機 Strata 根目錄。32K context、現有 Q2_0 量化及資源 guard 不任意變更。不要同時載入另一個大型模型、取消全部 sandbox、修改全域憑證，或將 mock 當成 live 證據。

公開匯入只調整路徑選擇與內附監控腳本；舊 runs 保留於原工作區，沒有上傳。新增驗收先記本次範圍與 AC，最後補精簡公開證據。不要為確認相同歷史結果重跑昂貴推論；runtime 有相關變更才做針對性回歸。
