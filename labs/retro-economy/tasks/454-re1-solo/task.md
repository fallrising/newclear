# Retro RE-1 單人路線

- Issue: https://github.com/fallrising/newclear/issues/454
- Session: Retro-20261021-1826
- Base: 6cd69eec883fce53133dfafbbc769e33fb588467（RE-0 已合併）
- Scope: Python 3.11 標準庫單執行緒 HTTPServer／SQLite；純規則；瀏覽器原生俯視格子地圖、角色、背包、簡短訊息；建角、移動、採集、專精製作、塔路；每動作原子保存、重啟續玩與重送去重。補 component tests、CI、README／SDD／SUCCESS 與報告。
- Acceptance: AC-01：兩職業規則單元測試、持久化與 HTTP 邊界測試；實際瀏覽器完成採集→製作→塔路並重啟伺服器後核對角色／背包／完成紀錄。
- Verification: 測試先失敗再實作；python3 -m unittest discover -s labs/retro-economy/tests -v；瀏覽器路線測試；python3 scripts/check_project_success.py；python3 .github/scripts/validate_llms_txt.py；git diff --check；最終 head 異模型家族審查與 CI。
- Boundaries: 不實作 RE-2 掛單／交易、不代答 RE-3 真人、不改 AGENTS.md／CLAUDE.md、不部署、付費 API、tag 或關 issue。
