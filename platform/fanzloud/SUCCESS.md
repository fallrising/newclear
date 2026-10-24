---
project: platform/fanzloud
purpose: 提供單人 Codex Cloud 任務控制與可追溯事件儲存
kind: application
mainline: incomplete
usable_tag: none
reviewed: 2026-10-21
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# Codebox / Fanzloud 成功契約

## 主線與範圍

[TD](docs/TD.md)的長期目標是 provider-neutral coding platform；已接受的 P0 是私人單 operator BYOS Codex Cloud 控制面。
P1 event store 與 T040A command planner 是後續獨立切片，尚未形成完整持久 actor/runtime。

保留 [README](README.md) 的 dormant 投入狀態；盤點不恢復開發。
個人訂閱不得池化、轉售或供第二個人喚醒；不允許 local codex exec/cloud apply 進 P0 authority。

本契約核對的是上述來源版本中的文件與程式。
`complete` 只適用明列的主線範圍；沒有延伸為部署或生產保證。

## 驗收條件

下表 `historical` 是既有報告的結果，沒有在 2026-10-21 重跑。
`pending` 保留缺少證據或尚未實作的條件；程式存在不等於通過。

| AC ID | Given / When / Then | 狀態 | 證據或缺少原因 |
| --- | --- | --- | --- |
| AC-01 | Given 固定 CLI 與 fake provider，When 瀏覽器建立任務並觀看狀態與 diff，Then HTTP/WS、session 與 trusted runner 依契約運作 | historical | [T007 驗收](docs/acceptance/T007.acceptance.md)、[README](README.md) |
| AC-02 | Given durable event prefix，When append/replay/save/load 與重啟組合，Then 權威事件不被損壞 cache 掩蓋且錯誤維持 typed | historical | [T030 組合驗收](docs/acceptance/T030.acceptance.md) |
| AC-03 | Given 三種 typed command 與 v1 狀態，When 決策函式執行，Then 只產生不可變零或一事件 proposal | historical | [T040A 驗收](docs/acceptance/T040A.acceptance.md) |
| AC-04 | Given 真實 operator Cloud entitlement，When 提交、追蹤與取回 diff，Then 同版 live smoke 能證明 provider 邊界 | pending | [交接](docs/HANDOFF.md)：credential-gated live operator smoke 未跑 |
| AC-05 | Given durable session 與 host runtime，When crash/recovery 或沙箱執行，Then 完整 actor/store/runtime 閉環保留一致狀態 | pending | [交接](docs/HANDOFF.md)：P1 store 未接 P0；T040 後續、node-agent/boxd 尚未完成 |

## 現況與缺口

T001–T007 及 T010/T020 有歷史接受，不能外推完整 TD。
T030A/B/C/D store 已獨立接受；P0 session replay 仍只在 process lifetime 內。
取消本機監看不能保證 provider task 已終止；未知提交只能依既有對帳介面處理。
實際原生 agent、local sandbox、多使用者認證不是已交付能力。

這次僅新增驗收入口，未改變 runtime 或原有驗收 oracle。
歷史結果若與現行 source 有相關差異，必須補驗而不能直接繼承。

## 啟動與驗證

[README 啟動章節](README.md)列出 pinned Codex CLI、私人 CODEX_HOME、state、Cloud environment、HTTPS origin 與 bootstrap token。

已核對入口：[control-plane main](apps/control-plane/src/main.rs)。
下列是該入口既有的啟動或驗證命令，並非本次執行紀錄；
需先完成連結文件中的依賴、設定及適用環境準備。

```sh
cargo test --locked --workspace --all-targets --all-features
cargo run -p codebox-control-plane
```

執行後應保留來源 SHA、必要設定的非秘密摘要、命令與結果，
並將 runtime 證據逐項對回 AC；不得只用 health 或 exit 0 宣告全部完成。

## 可用版本

目前 `usable_tag: none`；本次沒有建立或發布任何 tag。
既有版本號、合併紀錄與歷史驗收不自動轉換為可用版本標記。

須取得明確復工範圍、真 Cloud 主線驗證並補齊承諾的 runtime/persistence 整合；現有接受的函式庫切片不能作全平台可用標記。


## FE round2 plan — 2026-10-24

T-0380 R2-AC-14/E follows the existing approved [DESIGN](fe-review/DESIGN.md) M1–M3
and [T006R Ready task](docs/tasks/T006R.task.md)/[review specification](docs/specs/SPEC-T006R-fe-review.md).
Current work is documentation only; harness, measured presentation changes and runtime
are NOT_RUN. A separate root environment-only TLS trust probe passed; it served no
product assets/API/provider and does not satisfy those pending gates. Plan: finite synthetic HTTPS/WSS at loopback with private per-run TLS trust,
exact inherited contracts, three dark viewports/27 canonical states, focused no-resend/
secret/cleanup journeys, then required native gates and fresh independent acceptance.
Only baseline-proven index.html/p0.css/p0-app.js presentation changes may follow the
root document gate. Existing p0-client/backend/API/security/provider semantics stay
outside this change. Original offline native fake executables are allowed only as
retained regression tests; no production CLI/control-plane or newbackendbrowser run.
Targets remainsfalse until the scoped acceptance is evidenced. Existing product ACs,
mainline incomplete, usable_tag:none, dormant status and liveCloud/P1 gaps are unchanged;
no fullR3, deploy, release or ownercompletion is claimed.
