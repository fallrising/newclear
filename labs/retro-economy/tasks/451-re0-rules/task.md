# Retro RE-0 規則表

- Issue: https://github.com/fallrising/newclear/issues/451
- Session: Retro-20261021-1808
- Source: cda7571e（完整 SHA 見 report）
- Scope: SDD §7 RE-0 的一頁配方、數值、地圖與遭遇規則表；每種資源來源與去向；README、SUCCESS、必要 SDD 澄清與本任務報告。
- Acceptance: 來源與消耗完整、兩職業各一配方、地圖連通且路程有取捨、確定性路障／遭遇、一次性獎勵與重走語義一致。
- Verification: 人工逐項對照 SDD；python3 scripts/check_project_success.py；python3 .github/scripts/validate_llms_txt.py；git diff --check；最終 head 的異模型家族唯讀審查與 PR CI。
- Boundaries: 不實作 RE-1／RE-2、不代答真人試玩、不改 AGENTS.md／CLAUDE.md、不部署、不發 tag、不關 issue。owner prompt 已授權 commit、push、PR 及條件成立後 merge。
