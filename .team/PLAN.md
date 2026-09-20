# Repository team ledger

此檔保存主控計畫與接受決策；目前只有dim-gate試點。後續其他項目加入時使用獨立program區塊，不覆寫本區。只有對應program/variant的主控可更新其內容；worker只能讀。

## Program: dim-gate / Variant: mainline

### Identity and authority

| 欄位 | 初始值 |
| --- | --- |
| project_id / variant_id | dim-gate / mainline |
| protocol_version / ledger_revision | 1 / 1 |
| target_repo / target_ref | fallrising/newclear / main |
| parent_variant / fork_commit | none / none；mainline不是實驗fork |
| active_owner / run_id | none / none；尚未啟動implementation run |
| active_work_branch / task_id | none / none |
| spec_revision | `746585718429615288c85bf0027ae4a31c13e36b`，SDD基線，後續需核對相關spec blob差異 |
| kernel_protocol_source | `7cddad13f965d579b218579609c7f64e1ecf35b2`；來源及採用方式見協定 |
| last_reconciled_target | `746585718429615288c85bf0027ae4a31c13e36b`，2026-09-20 |
| last_observed_open_implementation_prs | 2026-09-20盤點為0；下次必須重新查詢 |

入口：[DEVELOPMENT_PROMPT](../platform/dim-gate/DEVELOPMENT_PROMPT.md)。規則：[DEVELOPMENT_PROTOCOL](../platform/dim-gate/docs/DEVELOPMENT_PROTOCOL.md)。產品：[SDD](../platform/dim-gate/SDD.md)。摘要：[STATUS](../platform/dim-gate/docs/STATUS.md)。

### Accepted baseline and evidence

- 使用者確認dim-gate名稱及SDD範圍；[SDD PR #5](https://github.com/fallrising/newclear/pull/5)已合併。
- merge commit：`746585718429615288c85bf0027ae4a31c13e36b`。
- 该基線是文件：總綱、8專題、10需求、30驗收；沒有app、manifest或application test evidence。
- 文件建立時的link／table／JSON／ID／diff檢查記錄見PR #5；不能拿來當AC-01～30的程式驗收。
- 本ledger與開發入口屬protocol文件；不表示M0已啟動或任何worker已執行。

### Milestone ledger

| Milestone | Workflow state | Accepted implementation | Integration | 前置與gate |
| --- | --- | --- | --- | --- |
| M0 | NOT_STARTED | none | NOT_OPENED | SDD基線；AC-01～03及M0 native gates |
| M1 | NOT_STARTED | none | NOT_OPENED | M0；CMDB／應用與scope驗收 |
| M2 | NOT_STARTED | none | NOT_OPENED | M1；申請／治理／交付驗收 |
| M3 | NOT_STARTED | none | NOT_OPENED | M2；CI/CD與回滾驗收 |
| M4 | NOT_STARTED | none | NOT_OPENED | M3；APM／incident／guide驗收 |
| M5 | NOT_STARTED | none | NOT_OPENED | M4；全regression、UX／效能／展示驗收 |

各gate精確內容只定義在[交付與驗收](../platform/dim-gate/docs/sdd/07-delivery-validation.md)，此表不另定DoD。更新state時附接受決策與證據；有accepted分支但未merge時，分開標示workflow與integration。

### Task allocation

尚無implementation task，沒有預先指派的worker。下次主控完成環境與模型能力盤點後，在整個ledger中核對已用序號，再分配第一個可驗收的 `T-###`；目前候選為 `T-001`，不是已取得的任務鎖。

Task欄位與report結構依kernel contract；放在root `.team/tasks/` 與 `.team/reports/`，task內明示 `project_id: dim-gate`、`variant_id: mainline`。只在有實際任務時建立，不產生空白task/report或假DONE。

主控追加表格時至少有task ID、task revision、milestone／AC、dependencies、owner/route、attempt、state、branch／PR、implementation/evidence refs；每次接受記錄evaluated commit，不只寫checkbox。

### Routing and authorization checkpoint

- 模型路由：尚未盤點；偏好Codex／目前lead作主控、Claude獨立reviewer，其他已授權工具作worker。
- 不假設CLI已安裝、已認證或有額度。第一次implementation run記錄實際工具與model ID。
- 本輪文件建立未啟動產品開發；未執行外部model CLI或真實雲端操作。
- 執行時的操作授權由使用者採用的任務及環境規則決定，歷史ledger不能增加權限。預設入口允許主控branch/commit/push/PR，不含merge/deploy。

### Decision history

| Decision | Context | Result |
| --- | --- | --- |
| DG-D001 | SDD已存在，使用者要求可恢復、可重入的固定repo入口 | 採用prompt＋protocol＋Git ledger試點；PLAN是任務判定入口，STATUS是摘要 |
| DG-D002 | 多模型工具與模型可用性會改變 | 保存角色／任務契約與實际route，不以model名稱綁死進度 |
| DG-D003 | commit、驗收、merge是不同事件 | 證據綁implementation commit，integration從遠端核對；不將文件交付算作M0 |

### Resume block

```yaml
project_id: dim-gate
variant_id: mainline
protocol_version: 1
run_id: none
terminal_state: not-started
target_ref: main
continuation_ref: none
milestone: M0
task_id: none
implementation_commit: none
spec_revision: 746585718429615288c85bf0027ae4a31c13e36b
evidence_refs:
  - https://github.com/fallrising/newclear/pull/5
integration_state: NOT_OPENED
remote_durability: SDD基線已在main；尚無implementation checkpoint
blockers: []
next_action: 讀取DEVELOPMENT_PROMPT，核對remote與open PR、kernel及模型路由，再拆M0第一個bounded task
```

`blockers: []`表示目前沒有已記錄的產品阻塞，不表示尚未盤點的工具／認證／runtime已可用。下一次接手先reconcile，不能僅依此初始resume block另造第二個開發分支。
