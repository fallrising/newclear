# OpenMMO Lab 任務板

## T-0995 — owner 啟用 P0 主線 / 2026-10-23

直接授權：START_DEVELOPMENT_PROMPT.md。基線 `b7f2a4311d1135977ba273efba8e77702b908036`；沿用既有 feature working tree，保留其他項目未提交變更。本表是項目進度權威；合併前不寫 done。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0995-01 | 已驗 pin/render、10 tests 與獨立 review；未合併 | AC-01 | in_progress | 2026-10-22T18:04:49Z | | 2026-10-22T18:33:31Z |
| T-0995-02 | 283 checksum、兩個 image build、terrain 初始化／重入通過；等 owner 提供 OAuth 私有設定路徑及指定資產來源資料 | AC-02 | in_progress | 2026-10-22T18:04:49Z | | 2026-10-22T18:33:31Z |
| T-0995-03 | 等 owner：兩個真人 Google 帳號與 WebGPU 瀏覽器移動、戰鬥、交易與取消 | AC-03 | todo | | | 2026-10-22T18:33:31Z |
| T-0995-04 | 等 owner：AC-03 真角色／背包資料後，驗 down/up 與不同 workspace/port 隔離還原 | AC-04 | todo | | | 2026-10-22T18:33:31Z |

本輪不做公開服務、agent/LLM、付費資源、改上游授權、提交或發布。Docker 本機可用，先使用本機隔離測試，無須停止既有測試服務。

結果：AC-01 passed；AC-02 partial/pending，AC-03/04 pending。詳見 [驗收](../acceptance.md) 與 [receipt](../evidence/2026-10-23.json)。本次 OpenMMO 容器 0 active；保留來源、runtime、images、terrain 與原始證據。沒有提交／合併，所以任務列不標 done。
