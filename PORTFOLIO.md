# Portfolio 投入決策

盤點日期：2026-09-05

## 結論

目前不是缺少可做的題目，而是同時開了太多戰線。35 個 portfolio unit 裡，只有 4 個 component 建議繼續投入；其中 `knowledge-base` 與 `ice-maker` 算同一條知識工作流，所以實際是 **3 條投入戰線**：知識編譯、個人意圖捕捉、雲端檔案盤點。

3 條是上限，不是最低配額。在其中一條產生真實、重複使用的成果之前，不應從休眠區提新專案上來。

本次依檔案樹、原始 source history、實際檢查、branch/PR 與依賴邊界判斷；不把 2026-09-04 的 squash import、migration、merge、successor notice、純格式或純 README commit 當成實質進度。`newclear/MIGRATION.md` 與 root README 明示 `newclear/refs/` 的 66 個項目是第三方索引，因此不算自有 component。

測試證據有一個整體限制：`newclear` 與 `kernel` 都沒有 root `.github/workflows`，匯入後留在 component 子目錄的 workflow 不會成為 monorepo CI；GitHub 目前也沒有這兩個 repo 的 Actions run。下表的「通過」是 2026-09-04 至 2026-09-05 在本機或 pinned disposable Docker 中重跑的結果，不代表 monorepo 有持續 gate。

Branch/PR 也以例外清單核對：目前 `newclear`、`kernel` 都只有 `main` 且沒有 open PR。公開 source 中需要決策的是 Goku、Phark、Fanzloud、Flowshot、Bee Swarm；其中只有 archived Fanzloud 還有 open PR #3/#4。Kernel source 中 OneCloud/PIF/CloudDrive/plugin 的 non-ancestor refs 都是較舊或已取代 tree，RelayVault task refs 在 main 後方，OneVPS/OneFleet 只有 main。8 個獨立 repo 中需要決策的是 Knowledge Base 的 4 條 note、Ice Maker 的保存快照、Local OCR T006 與兩條 fraud M7 WIP；目前 10 個 active repo 都沒有 open PR。其餘 component 沒有未合併 worker/agent 工作。

分級是依目前可觀察證據做的決策。凡是只有你知道的線上使用、真實使用者或期限，列在最後的問題；答案若成立，才調整分級。確認後，所有「休眠」項目的最近 README 應標注 `Dormant since 2026-09-04`、恢復條件與 canonical successor；本輪不先改 README。

## 2026-09-05 修復與補充驗證

這次把盤點中可安全修復的 source/build blocker 留在未提交 working tree，並用 repository-native gate 重驗：Streaming Converter 的 `upload.sh` 語法已修正；RelayVault 補齊 upload create/resume/status/cancel HTTP vertical slice 與 authorization-before-body 回歸測試；`infra/specs` 改為從 script 自身位置解析 monorepo component root，並修正 restrictive umask 下的公開 PostgreSQL/Redis fixture mode；Goku 與 CloudForm 清掉實際 lint error；AweShore lockfile 恢復 clean Linux install，五個檔案的既有 Prettier debt 也已清除。

這些修復沒有改變 portfolio 投入分級：能編譯或通過測試是最低技術門檻，不是使用者、部署或期限證據。仍需保留的限制包括：Ojbquay Java 有 10 個 Testcontainers case 因未掛 Docker socket 而無結果；Wotar 有 3 個 certificate-dependent skip；Goku `npm audit` 報 58 個 dependency vulnerability；jstgbot 報 3 個；CloudForm 有 14 個 non-failing lint warning；AweShore 有 1 個 non-failing Qwik warning。沒有在本輪自動升級 dependency。

## 繼續投入

| Component | 可驗證事實 | 理由 |
| --- | --- | --- |
| `knowledge-base` | 最後實質工作：2026-09-03 `a7fdf1d`；是有 index/governance 的知識 corpus，沒有 dependency manifest 或 native quality gate。`agent/personal-intent-router-t004` 已 patch-equivalent；4 條 `cursor/*` note branch 有獨有內容、無 open PR。 | 作為唯一 canonical durable knowledge store；先停止擴張 schema，把未合併 note 收斂成一份。 |
| `ice-maker` | 最後實質工作：2026-09-04 `ba28ad9`；read-only audit tree 起初擋住 runtime state，之後把同一 tree 複製到 writable temp 重跑 `make check`：303 tests 全過、5 skipped；同日 `main` GitHub CI run `33835493783` 也成功。需要 Python >=3.11，document ingestion extras 有 pin，production runner/VPS evidence 仍待真實環境。31 條 worker branch 多為已整合或被 main 超越的保存快照，目前無 open PR。 | 是知識線唯一 compiler/ingestion engine，而且仍有可驗證的近期實作；下一步應產生真實成果，不再擴建框架。 |
| `kernel/personal/pif` | 最後實質工作：2026-09-04 `41a224a`；239 個 deterministic tests 通過；舊 worker branch 是較舊／已取代 tree。依賴 pinned `cryptography==50.0.1`，尚無真實 Telegram/token smoke。 | 已有完整 local capture、加密、reconciliation、backup vertical slice；值得用一條真實 capture path 驗證是否會形成日常習慣。 |
| `kernel/personal/clouddrive` | 最後實質工作：2026-09-04 `bf0bf2b`；sandbox 內先有 6 組 loopback setup error，允許 disposable loopback socket 後重跑 `make check`，215 tests 全過；舊 branch 已被較新的 main 取代。真實路徑需要 operator-issued PikPak/WebDAV endpoint 與 credential。 | 對應明確的雲端 inventory、下載與校驗需求；但只做 read-only-first、已授權且 vendor-supported 的 surface spike，不走帳密型 reverse-engineered API。 |

## 維護模式

| Component | 可驗證事實 | 理由 |
| --- | --- | --- |
| `kernel/agents/codex-team-superpowers` | 最後實質工作：2026-09-04 `14309ca`；Python stdlib 實作的 16 tests 通過；目前這次盤點即在使用它的 task/report/evidence gate。nested workflow 在 monorepo 中不會執行；舊 agent refs 已被較新的 main 取代。 | 有真實用途且現有功能足夠；只修 validator、契約或相容性 bug，不擴建 dispatcher/UI。 |
| `local-ocr-services` | 最後實質工作：2026-09-04 `f98e59a`；Docker test image 38 tests 通過，3 組 Compose profile 可 render。`agent/t006` 有 233 行 load-test WIP、目前無 open PR；沒有 mandatory paid service，但 redistribution 前要補 license review。 | 保持為 Ice Maker 的隔離 OCR adapter；T006 load WIP 先標記 paused，只有 Ice Maker 的真實 workload 證明容量不足才恢復，平時只修相容性與安全 bug。 |
| `doc_analysis_study` | 最後實質工作：2026-09-03 `ad28e5c`；無外部 dependency manifest，Python repository validator 通過（3 studies、109 Markdown files）；所有 agent branch 已整合，無 open PR。 | 保留為 evidence-bounded study corpus，只在有新的真實研究題目時新增，不把它發展成第二套知識系統。 |
| `fallrising` | 2026-09-04 `dd978eb` 只是 portfolio README；除此之外沒有可執行內容、測試或依賴。 | GitHub profile map 本身在線且有用；只在 portfolio ownership 改變時同步。 |

## 休眠

| Component | 可驗證事實 | 理由 |
| --- | --- | --- |
| `newclear/products/goku` | 最後實質工作：2025-08-05 `fd181bd`；API、CLI、consumer 的 `go test ./...` 全過；web 清除 2 個 unused lint error 後 lint/build 通過，但仍無自有 test/CI，且 `npm audit` 報 58 個 dependency vulnerability。依賴 MQTT。`copilot` diverges、`gemini` 無共同 ancestor；本輪查詢時皆無 open PR。 | 多服務 prototype 已一年無實質進展；先保留 branch，除非你確認仍有每週使用者，否則不再投入。 |
| `newclear/products/phark` | 最後實質工作：2026-09-04 `9661090`；196 source files 與完整部署材料；Java 17 Maven suite 的 610 tests 全過，frontend clean install/lint/build 通過。24 條 worker branch 含 25 個 non-ancestor commit，其中 20 條 branch 已完整 merged；migration 說其餘工作已被 PR #10/#11 取代，但沒有 patch map；本輪查詢時無 open PR。 | **技術上是最完整的公開產品，但本輪未取得真實使用者／部署證據。** 在確認用途前，程式碼量不是繼續投入的理由。 |
| `newclear/gateways/pokercase` | 最後實質工作：2026-07-29 `c6b2cb7`；`cargo test --locked` 通過。要產生價值必須接個人 subscription token 或 provider credential；provider refresh/ToS 漂移是持續成本。source 只剩 successor notice，無待合併工作。 | 可用，但本輪未取得 post-import 使用證據；若它不是現在每天實際使用的 gateway，就停手。 |
| `newclear/systems/clarkq` | 最後實質工作：2026-07-30 `d18b65d`；有 deploy/demo/SDK，Go 1.22 `go test ./...` 通過；無 worker branch。 | 成熟 queue 不等於需要另一個 queue；本輪未取得真實 consumer 證據，不再加 cluster feature。 |
| `newclear/systems/snail` | 最後實質工作：2026-07-30 `55f24a2`；`cargo test --locked` 通過，Linux/io_uring 壓力宣稱未在本輪重驗；無 worker branch。 | 是不錯的系統程式練習，但本輪未觀察到真實 workload；保留 benchmark 歷史即可。 |
| `newclear/systems/ojbquay` | 最後實質工作：2026-07-30 `90d4a66`；280 個 Java/TS/shell files；console clean suite 的 5 tests 全過。Java 25/Gradle 產生 44 份結果，其中 10 個 Kafka/JDBC integration test 全因 Testcontainers 無法 discovery Docker 而失敗，不能判成 source regression。既有 `ojbquay-demo`/Kafka containers 已運行約五週，但仍未證明真實 consumer；agent branch 已整合。 | 技術與運維成本很高；先維持現有環境、不擴建，在確認它不是只有 demo 且有明確 consumer 後再升級投入。 |
| `newclear/systems/wotar` | 最後實質工作：2026-07-16 `6e1b4be`；Python 3.12 focused suite 為 175 passed、3 certificate-dependent skipped、16 deselected；真實 broker 驗證仍要 EMQX/Docker。 | security-sensitive E2EE client 不能只靠 local suite 維護；本輪未取得實際 MQTT 場景證據，先停。 |
| `newclear/platform/fanzloud` | 最後實質工作：2026-07-30 `c4b0b73`；focused domain tests 10 個通過，但 live BYOS smoke 從未跑。archive source 目前仍有 open PR #3（event store）與 #4（event replay），另有未匯入 branch。 | portfolio 投資面會與現有 Codex Cloud/agent tool 路線重疊；先處理兩個 open PR 的保存決策，再休眠，不應繼續擴建平台。 |
| `newclear/apps/loom` | 最後實質工作：2026-06-14 `1ba9dfa`；Node typecheck、35 tests 與 production build 通過，仍缺 Tauri GUI end-to-end；完整使用還要 LLM API credential。 | contract core 可保留，但本輪未取得日常 desktop 使用證據；不再做 plugin/runtime backlog。 |
| `newclear/apps/flowshot` | 最後實質工作：2026-07-30 `fbff4e9`；clean install、lint、6 tests 與 build 通過，仍是 N00 foundation，缺 GUI evidence；`agent/sdd-baseline` 有一個獨有 commit；本輪查詢時無 open PR。 | 需求合理但目前主要是規格與底座；只有在你願意把它當唯一閱讀工具時才恢復。 |
| `newclear/specs/fleet` | 最後實質工作：2026-09-04 `fc0504b`；Go 1.23 `go test ./...`（含 example）通過，nested CI 已失效；live ingress 依賴 Docker/Cloudflare。 | 與 `kernel/infra/onefleet` 問題域重疊；本決策只保留它作 public contract，不另外發展成第二個 control plane。 |
| `kernel/infra/onevps` | 最後實質工作：2026-09-02 `288db59`；preflight/bootstrap/schema/release/runtime checks 通過；真實 apply 需要 root、Docker/Tailscale 與目標 VPS。 | 本輪未取得 target-host 使用證據；若它沒有管理現役 VPS，就不是維護中的產品。 |
| `kernel/infra/onefleet` | 最後實質工作：2026-09-04 `8b038e4`；Go 1.24 `go test ./...` 通過，包含 M1 control-plane、unit/e2e targets 與 Docker fixture；真實 ingress 仍需要 Docker/Cloudflare。 | 本輪未取得第一個真實 node/service 證據，先暫停；恢復條件是能管理一個你真的在用的服務。 |
| `kernel/infra/specs` | 最後實質工作：2026-09-03 `396cbc4`；1,112 個 specification/evidence files。修正 monorepo root 與 restrictive-umask fixture 後完整 `make check` 通過，包括 disposable PostgreSQL/Redis isolation、restore 與 cleanup；Wave 7 仍明示缺 24 小時 soak/full-stack/scanner release evidence。 | 大量規格不是另一條產品線；先保留為 reference，沒有新 feature。 |
| `kernel/personal/relayvault` | 最後實質工作：2026-09-04 `d89d769`，其後 source head 明示為 WIP。缺失的 upload HTTP control plane 已補齊；fmt、clippy 與 102 個 workspace tests 通過，並有未授權 request 零 body-poll 與真實雙 SQLite connection lifecycle 測試。 | 技術 blocker 已解除，但仍與 CloudDrive transfer/verification 鄰近；先讓 CloudDrive 證明需求，再決定是否恢復。 |
| `kernel/infra/legacy/vps-hygiene` | 2026-09-04 前沒有 Git history；shell syntax 通過，含 host inventory/cleanup 與 dry-run，但 `--apply` 具 privileged/destructive 風險。 | 仍是 fleet contract 的行為參考，所以保留；不得當成新產品開發。 |
| `journal` | 最後內容變更：2024-10-26 `e6ef3ca`；最後 script 變更是 2024-10-19 `8d3dcfc`，只有一個 syntax-valid helper。 | 約 22 個月無活動；先作唯讀來源，只有選定的 durable note 才搬到 Knowledge Base。 |
| `fraud-edge-decision` | 最後實質工作：2026-09-04 `b5793cd`；`make check` 的 format、normal/race tests、build、acceptance/process packages 全通過。`agent/m7-local-infrastructure` 有 80 行 spec/WIP，目前無 open PR。 | **技術完成度高，但本輪未取得真實 stakeholder、流量或交付期限證據。** 未確認外部用途前，不把 M7/M8 做下去。 |
| `fraud-event-policy` | 最後實質工作：2026-09-04 `99b6426`；同樣通過完整 `make check`。`agent/m7-local-infrastructure` 有 79 行 spec/WIP，目前無 open PR。 | 與 edge component 是同一條 fraud program；本輪未取得真實 policy contract/consumer 證據，兩者一起休眠，不能把它算第二個成就。 |

## 收掉

| Component | 可驗證事實 | 理由 |
| --- | --- | --- |
| `newclear/apps/cloudform` | 最後實質工作：2026-06-15 `65e537e`；117 個 Java/TS files；Java 17 backend 23 tests 通過，frontend 補齊 ESLint 9 config 並修 2 個 lint error 後 lint/build 通過，保留 14 個 non-failing warning。完整路徑仍要 PostgreSQL、Redis、Docker。 | 寬而淺的多服務 prototype，雖已可重現 build，仍沒有獨特用途或真實部署證據；只留歷史。 |
| `newclear/tools/streaming-converter` | 最後實質工作：2024-11-13 `29a38ed`；沒有 tests/CI；`scripts/upload.sh` 的錯誤 `}` 已改為 `fi`，逐檔 `bash -n` 通過。仍依賴 FFmpeg、jq、bc、rclone、Nginx、Cloudflare R2。 | 語法 blocker 已修，但兩年未維護且整條 upload path 缺實際 smoke；除非仍在線上使用，否則不值得恢復投入。 |
| `newclear/examples/bite-pi` | 最後實質工作：2026-07-28 `0ddb21f`；Compose render 與 shell syntax 通過，但沒有 test suite，依賴外部 `decolua/9router` image 與 LLM keys。 | 是會快速過時的 demo/template；gateway 指引應由 Pokercase 或一份短文件接手。 |
| `newclear/labs/bee-swarm` | 最後實質工作：2025-07-26 `cc9d8a0`；simulation 可 compile 但無 tests，SimPy 未 pin；`project-restructure` 分歧 +33/-38、無 open PR。 | 多 agent workflow 問題已由實際使用中的 `codex-team-superpowers` 取代；保留歷史即可。 |
| `newclear/labs/aweshore` | 最後實質工作：2024-03-25 `504ad33`；README 已明示停止開發。修復缺少的 optional-platform lock metadata 與既有格式後，fresh Linux `npm ci`、Prettier、lint、typecheck、build 通過；API 仍找不到 `go.mod`，也無 tests/CI。 | 與 Knowledge Base 重疊；即使 UI build 已可重現，產品邊界仍不完整，確認 canonical note 後只留歷史。 |
| `kernel/infra/legacy` predecessor bundle（`config-center`、`crontab`、`ocmesh`、`doorkeeper`） | source head 分別止於 2023-11-27、2024-12-31、2026-09-04、2024-11-07；部分精確實質日期因原歷史未掛載而未核實。shell syntax 通過；ocmesh Go 1.24 `make test`（含 local E2E）通過，doorkeeper Deno check 仍未跑。已被 OneVPS/OneFleet 取代；其中 archived `config_center` 歷史還有已曝光 credential 風險。 | successor 已明確，繼續維護只會製造雙重權威；留下歷史與必要設計決策，不再當 component。 |
| `kernel/personal/legacy/jstgbot` | source head 2024-10-27；Node 20 clean `npm ci` 與 `node --check bot.js` 通過，但無 tests、runtime 要 Telegram/MQTT credential，且 npm 報 2 moderate/1 high vulnerability；已被 PIF 取代。 | 沒有獨立價值；保留 history，不維護。 |
| `kernel/infra/legacy/mac-in-docker` | 2026-09-04 前沒有 Git history；shell syntax 通過，但只是未驗證的 Docker-OSX/noVNC research draft，需要 KVM、大量資源與外部 image，另有 EULA 風險。 | 不是可靠 workload，也不是必要 contract；不再投入。 |

這裡用 migration-compatible 的 **11 個 kernel unit** 計數：7 個 active component、1 個 `infra/legacy` predecessor bundle、1 個 `personal/legacy/jstgbot`、以及另外盤點的 `vps-hygiene`、`mac-in-docker`。bundle 內四個 source boundary 的證據仍分別檢查，避免把不同年代與風險混成一筆。

## 重疊與 canonical 邊界

### 知識、文件與個人筆記

`knowledge-base` 是唯一 canonical knowledge store；`ice-maker` 是唯一 ingestion/compiler；`local-ocr-services` 只是隔離的 OCR runtime adapter；`doc_analysis_study` 是受限來源的 study staging area。研究結論經審核後進 Knowledge Base，不把整個 study repo 合併進去。

`journal` 只作舊 capture archive，`aweshore` 收掉；`flowshot`、`loom` 與 `goku` 雖然形態不同，也都在爭奪「讀、記、整理資訊」的注意力。除非其中一個已是你每天使用的介面，不能與 Knowledge Base/Ice Maker 同時開發。

### VPS 與 fleet

canonical boundary 應是：`kernel/infra/onevps` 擁有 privileged host lifecycle，`kernel/infra/onefleet` 擁有 application workload lifecycle；兩者不可合併權限。本決策只把 `newclear/specs/fleet` 當 public contract，不讓它形成第二套 runtime。`kernel/infra/specs` 是歷史設計 corpus；`ocmesh`、`doorkeeper`、`config-center`、`crontab` 已由前兩者取代；`vps-hygiene` 只保留作行為參考。

### Agent 與 LLM 工具

`kernel/agents/codex-team-superpowers` 是現有可驗證 workflow canonical。`bee-swarm` 收掉；本決策不另投資 `fanzloud` 的 cloud execution layer，因為它會與既有 Codex Cloud/agent tool 路線競爭同一份注意力，而且缺 live smoke；`bite-pi` 只是 demo。`pokercase` 只在它真的作為日常 gateway 時保留，不能順勢加入另一套 agent orchestration。

### 個人自動化與傳輸

PIF 取代 `jstgbot`，擁有 capture/reconcile/backup。CloudDrive 擁有 cloud inventory、annotation、transfer/verification lifecycle。RelayVault 的 HTTP upload control plane 現已編譯並通過安全邊界測試，可作未來 adapter；但需求仍與 CloudDrive 鄰近，沒有理由同時開工。

### Messaging 與資料基礎設施

ClarkQ、Snail、Ojbquay、Wotar 的協定不同，不需要硬合併；真正重疊的是它們都在消耗「基礎設施作品」預算，而本輪未取得 consumer 證據。在你確認真實 workload 前，四個一起休眠比選一個繼續加功能更合理。

### Fraud clean-room

`fraud-edge-decision` 與 `fraud-event-policy` 的 runtime/storage/outbox 邊界應保持分離，不能為減少 repo 數硬合併；但 portfolio 上只能算 **一條 fraud program**。沒有真實 stakeholder 時兩者一起休眠；有明確交付時一起恢復，edge 擁有 request/effect admission，policy 擁有 feature resolution/evaluation。

## 「繼續投入」的下一步

1. **Knowledge Base** — 在 4 條獨有 `cursor/*` branch 中選出要保留的內容，合成一份 canonical multi-model routing note；其餘明確標記 superseded。在完成前不新增第二份同題筆記。
2. **Ice Maker** — 用一份你真的需要的文件跑完整 ingestion → OCR（需要時）→ provenance → readable result，將一個有 citation 的成果落進 Knowledge Base；不要再新增 pipeline abstraction。
3. **PIF** — 用授權的非 production Telegram/test identity 做一次 capture → durable state → reconcile → encrypted backup/restore smoke；連續兩週沒有真實使用就降為休眠。
4. **CloudDrive** — 只做一個低權限、read-only-first spike：若供應商有授權且受支援的 WebDAV／connected-app surface，驗證其遞迴 listing、pagination、stable ID、size、download/resume 與可取得的 integrity metadata；若只能靠帳密型 private API，判定 No-Go。

## 需要你回答

1. 過去 30 天內，哪些真的有被你或其他人使用、部署或依賴：Goku、Phark、Pokercase、ClarkQ、OneVPS、OneFleet、PIF、CloudDrive、Ice Maker、Local OCR？請給「使用者／主機／頻率」；這會決定休眠項是否升為維護，也會驗證目前 3 條投入戰線。
2. 兩個 fraud repo 是否有真實 stakeholder、資料契約或明確截止日？若沒有，是否同意在 M6 停下並把兩條 M7 branch 標記為 paused？
3. 是否要保留下列未合併工作：Fanzloud open PR #3/#4、Knowledge Base 4 條 `cursor/*` note、Local OCR `agent/t006`、兩個 fraud M7 branch、Goku `copilot`/`gemini`、Flowshot `agent/sdd-baseline`、Bee Swarm `project-restructure`？Phark 的保存 branch 是否可依 migration 結論視為被 PR #10/#11 取代？
4. archived `config_center` 歷史中暴露的 n8n PostgreSQL/basic-auth credential 是否已完成輪換？「repo 已 archive」不等於風險已解除。
5. 是否同意把「繼續投入」限制為上述 3 條 90 天戰線，並在確認後為所有休眠／收掉項補狀態與停止日期？
