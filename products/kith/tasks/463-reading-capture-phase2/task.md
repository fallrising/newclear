# Kith 階段 2：閱讀、人類補充與匯出

Session: Kith-20261022-0352
Issue: https://github.com/fallrising/newclear/issues/463
Base: cd6412e5feaad219f8b0101c28b1dda79b3b7151
Desk: N/A — owner 直接指定里程碑，沿用 milestone-agent-prompt 的 issue/CLAIM/draft PR 流程。
start: 2026-10-22T03:53:29Z
end: pending
last_activity: 2026-10-22T03:53:29Z

## 範圍

閱讀頁、人類補充、固定commit內容建置及原子版本切換、自動更新、受限可撤權Runner憑證、D1→Git匯出與遠端push後ACK。RC-05～07與RC-01～04回歸。不新增付費依賴、正式內容、部署、公開發布、雙向同步或離線隊列。

只改products/kith、.team調度與本階段必要的既有.github/workflows/kith.yml及docs/specs/monorepo-ci.md。CI只建置／驗證，不新增部署、秘密或發布權限。

## 驗收與驗證

先固定文章ID、API／憑證／JSON／Runner故障恢復契約，獨立測試先RED再實作。隔離本地CF/D1、Git bare remote、桌面／手機，驗證停止／恢復、寫檔／commit／push後故障、ACK競態、人工Git更動、正文改名更新、失敗建置保留完整舊版及快記可用、Runner撤權與私有靜態資產拒絕。

所有build/test經共用workspace launcher，固定Node24.18.0。worker/E2E types、unit/integration、web/content build、完整E2E與manifest、schema、project-success、llms、diff與team contracts；不同模型家族唯讀最終head審查、最終head CI全綠、最新main整合後再驗證才merge。

## 授權

Owner明確要求提交並合併。只合併本PR，merge commit且match-head；不關issue、不刪branch/tag、不改AGENTS/CLAUDE、不force push、不部署或付費API。Grok既有登入優先；若用OpenCode，僅deepseek-v4.1-flash。
