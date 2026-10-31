# 公開證據摘要

[2026-10-31.json](2026-10-31.json) 由本機六個 result.json 以欄位白名單抽取，保留結果、usage、hash、取消及清理；不含 session ID、worker ID、prompt、登入連結或私人路徑。每筆附原檔 SHA-256，原始檔仍留本機，公開讀者無法僅憑摘要獨立核對原始 bytes。
[source-hashes.json](source-hashes.json) 記錄匯入前的 lab 腳本 hash。這些是歷史證據，本次未重新執行大型模型。

| 原始實驗 | 結果 |
| --- | --- |
| Codex 檔案任務 | 203 output tokens，43.03 秒，marker／sum 正確，清理成功 |
| Codex 合成 queue 修復 | 629 output tokens，61.17 秒，5 個公開測試與獨立驗收（100 組隨機案例）通過 |
| OpenCode CLI | 232 output tokens，40.96 秒，檔案正確 |
| Office 原生 OpenCode | 229 output tokens，52.95 秒，idle → working → done、session 存在、hash 正確 |
| Office 取消／keep-open | 第一任務通過；第二任務取消 202 ms，所屬程序退出；人工結束後頂層 stopped，非偽稱 completed |
| OpenCode sandbox probe | loopback／workspace 寫入允許、外部網路／區外寫入拒絕、服務離線即失敗 |

其他歷史結果：Office 固定 commit `852e2ab28c4f3f31bffdf4b20353bd119c9d3270` 的 typecheck／build 成功、614 tests 通過；基底登入／401／redirect／lite 真瀏覽器 smoke 通過；本地 provider policy 5 tests 通過。原始日誌、截圖與瀏覽器 profile 沒有公開，因此本頁僅為歷史執行摘要。

保留的失敗包括：受限環境無 Metal／socket、Codex 109,823-token prompt 超出 32K、模型把 apply_patch 寫成文字未改檔、OpenCode 插件缺 SDK 時等待，以及取消驗收等待 activity=bash 超時。後續修正沒有覆寫失敗紀錄。早期 Strata GitHub 研究 loop 未驗收成功，不能把外層代理的研究冒充本地模型產出。

舊文件原 runs 連結統一改指向本摘要，不表示 raw log／圖片在 repo 中。詳細已知限制見 [SUCCESS](../../SUCCESS.md)。本次匯入檢查另記於 [publication.md](publication.md)。

後續新增：[T-0004 生命週期](lifecycle.md)、[T-0005 host 中斷與手動恢復](restart.md)。各自保留當輪 runtime hash、先前失敗與範圍，不覆寫歷史結果。
