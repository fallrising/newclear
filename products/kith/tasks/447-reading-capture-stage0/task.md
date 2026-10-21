# Kith 閱讀快記階段 0

Session: `Kith-20261021-1805` (UTC)
Issue: https://github.com/fallrising/newclear/issues/447
Base: `cda7571e` (origin/main)

## 目標與授權

依 owner 2026-10-22 milestone-agent-prompt 與「直接認領」指示，完成一個里程碑：計劃定案、captures/notes migration 草稿、RC-01～07 測試清單。允許 commit/push/draft PR，最終 head CI 全綠、異模型家族唯讀審查通過及同步 main 後 merge commit；不關閉 issue。

## 範圍

`products/kith/docs/plans/cloudflare-reading-capture*`、該草稿的 Python/SQLite 檢查、SUCCESS/README、此 task/report。依上層 team 規則，`.team/PLAN.md` 的本 session 區塊及 `.team/tasks/T-109.md`、`.team/reports/T-109.md` 是必要交付例外。不改 runtime、現行 migrations、依賴、AGENTS/CLAUDE、部署或其他元件。

## 驗收與驗證

- 草稿放 docs/plans 下，不被 Wrangler migrations_dir 載入；SQLite 合成資料驗證欄位、冪等、補充對應及既有表不變。
- RC-01～07 各有可執行的前置、動作、oracle、故障切點、證據需求及實作階段；runtime 案例維持 pending。
- 先觀察新增草稿驗證失敗，再完成 SQL 並重跑。
- `python3 -m unittest discover -s products/kith/docs/plans/reading-capture-tests -v`
- `python3 scripts/check_project_success.py`
- `python3 .github/scripts/validate_llms_txt.py`
- `git diff --check`
- 本機必要 checks 及 PR 所有 CI 通過才合併；保留未跑/失敗與工具鏈限制。最終 head 由非 GPT 家族 readonly reviewer 審查。
