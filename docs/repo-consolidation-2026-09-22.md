# 主幹整併紀錄：2026-09-22

以 origin/main `ad73f55` 為起點；操作前沒有 open PR。PR #1–#28 已 merged，但其中部分 base 不是 main，且 squash 合併留下非祖先分支。

## 實際補入的內容

- HAI taskboard `0f79b14`：fake runtime／前端／規格。原根 `.team` 的 142 個檔案逐一以 Git blob SHA 驗證後移至 `products/hai-taskboard/.team`，根目錄既有 dim-gate ledger 不變。HAI 活躍入口改指向自己的 ledger，歷史報告原文保留；見該目錄 INTEGRATION-NOTE。
- mkfk：PR #3 當時合進 docs/mkfk-sdd，Enhanced CSR 尚未到 main；現在補入單檔規格及入口。主幹既有 M0–M5 runtime／測試保持不變，修正 AGENTS 過時的「只有規格」描述。
- ERU `e4b2915`：Go 1.27.1 修補驗證、控制面診斷、精確 worker 重裝／恢復底層與本機測試。沒有部署或實機重裝。

## 已合併內容的分支歷史

以下 refs 在內容驗證後使用 ours merge 記錄祖先關係；合併前後 tree SHA 完全相同。没有用這種方式丟棄未合入功能。

| Ref | Commit | 依據 |
| --- | --- | --- |
| `refs/heads/docs/kith-sdd-baseline` | `93dc6614b46f` | Kith 文件樹與 rebase 後的 3f5c5fe 相同；隨 PR #12 合入。根 README 差異只有其他專案的後續更新。 |
| `refs/heads/feat/eru-vps-mvp-handoff` | `ba4fe4b958f0` | 完整累積 diff 與已合併 PR #27 相同。 |
| `refs/heads/feat/kith-deploy` | `d5ad2b90e72e` | 完整累積 diff 與已合併 PR #26 相同。 |
| `refs/heads/feat/kith-m0` | `4225fa27c319` | Kith/CI 樹與 PR #19 的 f369757 相同；保留主幹後續 README 更新。 |
| `refs/heads/feat/kith-ui` | `f3697578e6ca` | 完整累積 diff 與已合併 PR #19 相同。 |
| `refs/remotes/origin/agent/agent-platform/m0-kvm` | `965abf5e381b` | 完整累積 diff 與已合併 PR #16 相同。 |
| `refs/remotes/origin/agent/agent-platform/m1-control-plane` | `44f31791fb9f` | 完整累積 diff 與已合併 PR #18 相同。 |
| `refs/remotes/origin/agent/agent-platform/m2-runtime` | `cc302542e4b0` | 完整累積 diff 與已合併 PR #21 相同。 |
| `refs/remotes/origin/agent/agent-platform/m3-approval` | `1949ffa507d0` | 完整累積 diff 與已合併 PR #25 相同。 |
| `refs/remotes/origin/agent/agent-platform/m3-cancel` | `a0a0318379f3` | 完整累積 diff 與已合併 PR #24 相同。 |
| `refs/remotes/origin/agent/agent-platform/m3-pause` | `be163569eda7` | 完整累積 diff 與已合併 PR #28 相同。 |
| `refs/remotes/origin/agent/agent-platform/m3-recovery` | `6361c3cd8d34` | 完整累積 diff 與已合併 PR #22 相同。 |
| `refs/remotes/origin/docs/agent-platform-sdd` | `c3e18b57920d` | 完整累積 diff 與已合併 PR #14 相同。 |
| `refs/remotes/origin/docs/dim-gate-development-entry` | `c523f569091d` | 完整累積 diff 與已合併 PR #6 相同。 |
| `refs/remotes/origin/docs/dim-gate-sdd` | `1613e2af17c5` | 完整累積 diff 與已合併 PR #5 相同。 |
| `refs/remotes/origin/docs/kith-sdd-baseline` | `93dc6614b46f` | Kith 文件樹與 rebase 後的 3f5c5fe 相同；隨 PR #12 合入。根 README 差異只有其他專案的後續更新。 |
| `refs/remotes/origin/feat/agent-platform-m0-contracts` | `e4c5ce175414` | 完整累積 diff 與已合併 PR #15 相同。 |
| `refs/remotes/origin/feat/eru-vps-mvp-handoff` | `ba4fe4b958f0` | 完整累積 diff 與已合併 PR #27 相同。 |
| `refs/remotes/origin/feat/kith-deploy` | `d5ad2b90e72e` | 完整累積 diff 與已合併 PR #26 相同。 |
| `refs/remotes/origin/feat/kith-m0` | `3c6ffc915bfe` | 完整累積 diff 與已合併 PR #12 相同。 |
| `refs/remotes/origin/feat/kith-ui` | `f3697578e6ca` | 完整累積 diff 與已合併 PR #19 相同。 |

## 驗證與界線

- HAI Go 1.27.1：go mod verify、go vet ./...、go test -count=1 ./...、go test -race -count=1 ./...、CLI build 全部通過。
- HAI Node 24.20.0／pnpm 11.25.0：frozen install、format、lint、8 項測試與 production build 通過。jsdom 輸出 canvas 未實作提示；未以此宣稱真實瀏覽器 canvas 驗收。
- ERU：62 項 Python 本機測試通過；既有失敗 journal 保留，實機重裝仍為 0/3。
- 未宣稱 HAI 的 G1、瀏覽器驗收或真實 provider 整合完成。
- 另一 Kith 工作樹的未提交修改不屬於分支 commit，完整保留，沒有 stage／reset／stash。
- ERU private symlink、credentials、實機 inventory 與 raw evidence 沒有加入 Git。分支保留，沒有刪除遠端分支。
