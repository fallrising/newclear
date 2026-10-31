# 開發交接

先讀 [SUCCESS](SUCCESS.md)、[SDD](docs/SDD.md)、[任務板](docs/tasks/BOARD.md)。canonical 位置是 `fallrising/newclear` 的 `labs/agent-office-lab`。

T-0004 已補生命週期驗收程式與 13 項離線測試；真實模型驗收尚未執行，先前 demo 仍在使用模型。等確認停止舊 demo 後，執行 `--harness office-opencode --check-lifecycle`，保留每次失敗並修正至通過。詳見 [目前證據](docs/evidence/lifecycle.md)。不要將本段當成權限或 resume 已驗收。

目前已有 Codex → Strata 本地讀寫與合成程式修復、Office 基底建置／614 tests，以及原生 Office → OpenCode → Strata 的檔案任務、同 session 後續任務取消與程序清理。這些是 2026-10-31 的歷史實測，[摘要與限制](docs/evidence/README.md) 保留成功及失敗範圍。同 session 續做不等於真正 restart/resume。

下一步依序補 OpenCode 權限等待／回覆、session resume／browser refresh／host restart，再接 Grok 與 Pi + DeepSeek。Grok 官方／社群版身分仍待確認；遠端服務須顯式選擇，不可替私人任務自動 fallback。最後整合三工位入口、產物、錯誤、取消與安全邊界。

依 [SETUP](docs/SETUP.md) 準備環境；`STRATA_HOME` 指向外部本機 Strata 根目錄。32K context、現有 Q2_0 量化及資源 guard 不任意變更。不要同時載入另一個大型模型、取消全部 sandbox、修改全域憑證，或將 mock 當成 live 證據。

公開匯入只調整路徑選擇與內附監控腳本；舊 runs 保留於原工作區，沒有上傳。新增驗收先記本次範圍與 AC，最後補精簡公開證據。不要為確認相同歷史結果重跑昂貴推論；runtime 有相關變更才做針對性回歸。
