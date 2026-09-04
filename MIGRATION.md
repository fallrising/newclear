# Repository 收斂遷移紀錄

起始:117 個 repository（52 source + 65 fork）· 目標:10 個
盤點與遷移日期:2026-09-04

## 進度

| Phase | 內容 | 狀態 |
| --- | --- | --- |
| 0 | 安全與盤點:未推送工作保全、secret scan、分歧驗證 | ✅ 完成 |
| 1 | Fork 收斂:catalog 產生、patch 抽取、repo 移除 | 🔄 catalog 完成,待移除 |
| 2 | `newclear` 匯入:公開專案 squash 匯入 | ⏳ 骨架完成 |
| 3 | `kernel` 匯入:私有專案 squash 匯入 | ⏳ 未開始 |
| 4 | 收尾:profile README、archive 舊 repo | ⏳ 未開始 |

## Phase 0 成果（已完成）

保全了 **223 個只存在本機的 commit**,分散於 7 個 repository:

| Repository | 保全的 commit | 動作 |
| --- | ---: | --- |
| `onecloud` | 108 | 推送 21 個分支;`main` fast-forward +72 |
| `clouddrive_pulse_reader` | 44 | 推送 23 個分支;`main` fast-forward +28 |
| `ice-maker` | 26 | 推送 26 個分支（內容已在 `main`） |
| `phark` | 25 | 推送 24 個分支（內容已被 PR #10/#11 取代） |
| `personal-intent-flow` | 15 | 推送 12 個分支;`main` fast-forward +10 |
| `codex-team-superpowers` | 4 | 推送 4 個分支（內容已在 `main`） |
| `flowshot` | 1 | 推送;`main` fast-forward +24 |
| `relayvault` | 0 | `main` fast-forward +1 |
| `knowledge-base` | 0 | 補提交未追蹤的 `.team/` |

盤點修正:實際為 **117** 個 repository,`relayvault`（private, Rust, 2026-09-04 建立）先前未被列入。

## 匯入方式

每個 component 以**單一 squash commit** 匯入,commit message 記錄來源 repository、原 HEAD SHA 與匯入日期。
完整 git 歷史保留在原 repository（archive,不刪除）。

理由:避免把歷史中的敏感內容帶進公開 monorepo,並避免 `goku` 的 57 MB 歷史污染。

## 待匯入清單

### → `newclear`（public）

| 目標路徑 | 來源 repository | 附帶吸收 |
| --- | --- | --- |
| `products/goku/` | `goku` | `goku-web-server`、`goku-consumer`、`goku-web` |
| `products/phark/` | `phark` | `obechow`（delivery evidence） |
| `gateways/pokercase/` | `pokercase` | `llm_gw`（安全設計決策） |
| `systems/clarkq/` | `clarkQ` | `queue_api`（已取代,不搬） |
| `systems/snail/` | `snail` | — |
| `systems/ojbquay/` | `ojbquay` | — |
| `systems/wotar/` | `wotar` | `emqx-consumer`（已取代,不搬） |
| `platform/fanzloud/` | `fanzloud` | `vnc_lab`（sandbox requirements） |
| `apps/loom/` | `loom` | `tiptap-editor`（已取代,不搬） |
| `apps/flowshot/` | `flowshot` | — |
| `apps/cloudform/` | `ai-native-workflow-form` | — |
| `tools/streaming-converter/` | `streaming_converter` | — |
| `labs/bee-swarm/` | `bee_swarm` | — |
| `specs/fleet/` | `fleet-catalog` | — |
| `examples/bite-pi/` | `bite-pi` | — |

### → `kernel`（private）

| 目標路徑 | 來源 repository | 附帶吸收 |
| --- | --- | --- |
| `infra/onevps/` | `onevps` | `config_center`、`crontab` |
| `infra/onefleet/` | `onefleet` | `ocmesh`、`doorkeeper` |
| `infra/specs/` | `onecloud` | — |
| `personal/pif/` | `personal-intent-flow` | `jstgbot`（use cases） |
| `personal/clouddrive/` | `clouddrive_pulse_reader` | — |
| `personal/relayvault/` | `relayvault` | — |
| `agents/codex-team-superpowers/` | `codex-team-superpowers` | — |

### 不搬,直接 archive

`maven-repo`、`fallrising.github.io`、`aweshore`、`aweshore-ui`、`queue_api`、`tiptap-editor`、
`emqx-consumer`、`db-gateway`、`witness`、`easy-pkms`（決策移入 `knowledge-base`）

### 刻意保持獨立

`fallrising`（profile）、`knowledge-base`、`doc_analysis_study`、`journal`、`ice-maker`、
`local-ocr-services`、`fraud-edge-decision`、`fraud-event-policy`
