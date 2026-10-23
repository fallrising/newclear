# OpenMMO Lab 任務板

## T-0995 — owner 啟用 P0 主線 / 2026-10-23

直接授權：START_DEVELOPMENT_PROMPT.md。基線 `b7f2a4311d1135977ba273efba8e77702b908036`；沿用既有 feature working tree，保留其他項目未提交變更。本表是項目進度權威；done 只用於已完成並合併的任務列，未驗收的 AC 維持開啟。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0995-01 | pin/render、10 tests 與獨立 review 通過；PR #532 已合併 | AC-01 | done | 2026-10-22T18:04:49Z | 2026-10-23T12:46:12Z | 2026-10-23T12:46:12Z |
| T-0995-02 | 283 checksum、兩個 image build、terrain 初始化／重入通過；等 owner 提供 OAuth 私有設定路徑及指定資產來源資料 | AC-02 | in_progress | 2026-10-22T18:04:49Z | | 2026-10-22T18:33:31Z |
| T-0995-03 | 等 owner：兩個真人 Google 帳號與 WebGPU 瀏覽器移動、戰鬥、交易與取消 | AC-03 | todo | | | 2026-10-22T18:33:31Z |
| T-0995-04 | 等 owner：AC-03 真角色／背包資料後，驗 down/up 與不同 workspace/port 隔離還原 | AC-04 | todo | | | 2026-10-22T18:33:31Z |

本輪不做公開服務、agent/LLM、付費資源或改上游授權。首次驗證階段沒有 Git 發布授權；owner 隨後明確授權提交、PR 與合併，已依此完成下列交付。Docker 本機可用，先使用本機隔離測試，無須停止既有測試服務。

結果：AC-01 passed；AC-02 partial/pending，AC-03/04 pending。詳見 [驗收](../acceptance.md) 與 [receipt](../evidence/2026-10-23.json)。本次 OpenMMO 容器 0 active；保留來源、runtime、images、terrain 與原始證據。AC-01 任務已合併而標 done；AC-02/03/04 仍保留開啟，合併不等於遊戲主線驗收。

## 合併與重啟接手

- [PR #532](https://github.com/fallrising/newclear/pull/532) 於 `2026-10-23T12:46:12Z` 合併；commit `a748a8069b81984207fdb54b9202a33ecc32455f`。
- 本機 10 tests、最新 main 上 42 項文件契約與 diff 檢查通過；GitHub Project success contracts CI 通過後以相符 head 合併。
- 本次 OpenMMO 容器 0 active；確認 terrain named volume 存在。外部 source、runtime `.env`、images、terrain 與共用 workspace 證據持久保留；沒有刪除或搬動資料。
- 重啟接手用共用 workspace `openmmo/final-receipt-20261023/preserve/artifacts/runtime-handoff.json` 的私有路徑。先補真實 Google client ID，再依 quickstart 執行 doctor/up；不改 runtime 絕對路徑，避免變成另一個世界。
- AC-02 的特定素材來源資料及 AC-03/04 真人 WebGPU／角色保存還原仍待驗；無 usable tag 或部署。
