# Kith 閱讀快記階段 0

Session: Kith-20261021-1804
Issue: https://github.com/fallrising/newclear/issues/446
Base: cda7571e8d45c9c9f036d8b65e41ad26362f7492

## 範圍

交付 cloudflare-reading-capture.md §7 階段 0：定案資料契約、兩張表的 migration 草稿與 RC-01～07 測試清單。草稿放在 docs/plans 下，不納入自動 migration。只修改 products/kith 的相關文件、草稿與隔離 SQL 測試，以及本次 .team 計畫／任務／報告。

## 驗收

- 保留單 operator、D1 人類資料權威、Git AI 正文權威、首次保存不經 AI。
- SQL 草稿只新增 captures/notes 及必要索引；冪等鍵唯一、不改聊天室表。
- RC 清單逐項寫 fixture、故障切點、可觀測斷言與階段；未實作項目不宣稱通過。
- 更新 SUCCESS 與 README，保留原聊天室 AC 狀態。
- 最終 head 本機檢查、CI 與不同模型家族獨立審查全部通過才合併。

## 驗證計畫

先寫 SQLite 隔離測試並記錄 RED，再加入 SQL 草稿取得 GREEN。所有新測試使用共用 workspace launcher。執行本次測試、scripts/check_project_success.py、.github/scripts/validate_llms_txt.py、git diff --check；本次沒有 API/UI/Runner 實作，不將 SQL 測試替代 RC E2E。

## 授權與限制

Owner 本次 prompt 授權 commit、push、draft PR 與條件成立後 merge commit。禁止部署、付費 API、force push、修改 AGENTS.md/CLAUDE.md、刪 branch/tag、關閉 issue。只交付本里程碑。
