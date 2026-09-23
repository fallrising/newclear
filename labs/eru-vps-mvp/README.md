# Eru VPS MVP

最新狀態：[優先路徑與故障分析](docs/M2-PRIORITIES-2026-09-22.md)。core 修補已部署，worker-4 的新操作器 smoke 已 PASS；worker-4 元件重裝已完成連續三次實機驗收。下列早期紀錄保留作背景，以最新實測為準。

以 Project Eru quickstart 驗證 4 台 VPS 的工作負載排程、部署與可重複重建。

**狀態：已完成 Debian 13 的 1 core + 3 worker 部署；三台 nginx lifecycle／HTTP／資源拒絕與清理全部通過。帶運行中 nginx 的四台重複 apply（V05）也已通過；OS 重灌及完整重建驗收尚未完成。** 2026-09-21 依 owner 要求建立。2026-09-22 由 controller B 對四台測試 VPS 完成實機檢查。SDD 指 Software Design Document（軟體設計文件），同時列出後續實作的需求與驗收契約。

最新開發進度：[故障恢復與 patched reapply](docs/M2-RECOVERY-2026-09-23.md)，操作見 [RECOVERY.md](docs/RECOVERY.md)。前一輪 [優先路徑與實測](docs/M2-PRIORITIES-2026-09-22.md)：Go 1.27.1 core 修補已驗證並部署，新的 worker-4 smoke、精確非空 cleanup 與連續三次元件重裝均通過；82 項 Python 本機測試通過。歷史 etcd 儲存停頓根因仍待追蹤；core 實機故障、OS 重灌與 HA 分開驗收。早期失敗與進度保留在 [M2 開發紀錄](docs/M2-2026-09-22.md) 和 [隔離建置紀錄](docs/M2-CONTINUATION-2026-09-22.md)。

4 台 VPS 可以做 MVP。建議先跑 **1 台 etcd/core + 3 台 containerd worker**；通過基本部署與重建後，再用同一批機器冷重建成 **3 成員 etcd + 1 core + 3 worker**，驗證 metadata quorum。後者仍有單一 core，不能稱為整體 HA。

實際四台為 Debian 13；前三台 6 vCPU／25.4 GiB RAM，第四台 12 vCPU／47.1 GiB RAM，皆已連上 Tailscale。原 SDD 的 Ubuntu 24.04 與 2 vCPU／4 GB 是設計假設，現有環境需要適配，詳見實機報告。

| 文件 | 內容 |
| --- | --- |
| [接續開發交接](docs/HANDOFF.md) | 環境、已定案偏好、實機故障、私有 evidence 與下一步 |
| [自控清理重裝](docs/CONTROLLED-REINSTALL.md) | 日常預設元件重裝、ownership 審核與 provider 控制台後備路徑 |
| [操作器](docs/OPERATOR.md) | plan／hash／互斥鎖／journal／reconcile 與精確清理 |
| [開發紀錄](docs/M2-2026-09-22.md) | M2 第一部分、本機回歸與實機故障處理 |
| [部署與測試結果](docs/DEPLOYMENT-RESULT-2026-09-22.md) | 3/3 worker 驗證、原服務復核、驗收缺口與下一步 |
| [已批准部署計畫](docs/DEPLOYMENT-PLAN.md) | 具體新增服務、worker key／socket 權限、firewall 與回復範圍 |
| [實機盤點與部署缺口](docs/LIVE-2026-09-22.md) | 4 台實測結果、權限／Docker 相容性與下一步 |
| [SDD](docs/SDD.md) | 能做什麼、4 機架構、網路、管理介面、重建語意、MVP 驗收與取捨 |
| [操作手冊](docs/RUNBOOK.md) | 已核對的上游指令、首次部署、單機重裝、冷重建、快照還原 |
| [來源與缺口](docs/SOURCES.md) | 固定 commit、文件與原始碼差異、未驗證項目 |
| [驗收記錄](docs/VALIDATION.md) | 本次文件／範例檢查，以及待做的 live evidence |
| [基礎 inventory](examples/inventory.basic.yml) | 1 控制 + 3 worker，假想私網位址 |
| [quorum inventory](examples/inventory.quorum.yml) | 3 etcd 成員的冷啟動配置，不是線上擴容腳本 |
| [nginx spec](examples/nginx.yaml) | 最小 HTTP 工作負載 |
| [實測 artifact lock](artifacts.amd64.lock.json) | 6 份實際下載校驗的 release 與 nginx manifest digest |
| [版本基線](upstream.lock.json) | 研究所用 commit 與上游版本；尚非完整可重現安裝鎖檔 |

此專案是有界限的實驗：不新增另一套常駐 fleet control plane。對既有 OneVPS／OneFleet 的整合只定義邊界；Eru 與既有 runtime 不同時管理同一個應用。真實 inventory、IP、SSH key、快照及 provider state 放在私有操作目錄，不提交到公開 monorepo。

已新增 `scripts/labctl.py`，提供 plan／execute／status／reconcile，詳見操作器文件。SDD 其餘 bootstrap、應用 desired-state、worker／全群重灌、backup／restore 命令仍是待實作契約；沒有供應商重灌程式或全群 reset。

## 實機診斷工具

```bash
python3 scripts/preflight.py --output-dir private/preflight
python3 scripts/check-binaries.py --output-dir private/binary-checks
```

所有遠端執行透過已配置的四個 SSH alias。二進位檢查只在臨時目錄執行 version 命令，未安裝 systemd 服務；輸出含主機資料，保留在被忽略的 private 目錄。完整語意與限制見實機報告。

## 現有 Debian 實驗叢集

controller B 的 SSH 入口是 `~/.ssh/config`，匯入 `~/.ssh/hzd-vps/config`；安裝與測試使用 `ckc-disposable-01`～`04`，登入 ckc 並 sudo。01 為控制面，02–04 為 worker。

```bash
# 只在 B 產生 private/deployment-plan.json，沒有遠端變更。
python3 scripts/deploy-lab.py
# 建立唯一命名的 nginx、驗證、清除；預設三台，可用 --node worker-2 限制。
python3 scripts/smoke-lab.py
```

首次部署使用 `scripts/deploy-lab.py --apply`，已於本次批准後完成。此工具依賴本機 private preflight、已驗證 host public keys 與現有可信 SSH 設定；尚不能在新 controller 上直接 bootstrap。現有完整環境的同版本重複 apply 已通過一次驗收，請見 [操作手冊的 Debian 路徑](docs/RUNBOOK.md)。
