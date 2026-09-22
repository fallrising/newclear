# ERU Debian MVP：部署與測試結果

2026-09-22，owner 回覆「批准。」後，由 controller B 經 `ckc-disposable-01`～`04` 完成首次安裝。**1 core + 3 workers 已運行，三台 nginx 功能測試全部通過；再次批准後，帶 nginx 的四台同版本重複 apply（V05）亦通過。這證明四台 VPS 可以做此功能 MVP；反覆 OS 重裝管理仍未完成。**

後續 M2 測試發現 etcd 磁碟同步延遲及 core 的 nil-context panic，詳見 [開發紀錄](M2-2026-09-22.md)。以下 PASS 是先前部署／V05 時段的結果，不代表已通過穩定性或重建驗收。

## 首次部署與 V05 後的狀態

| SSH alias | Eru 角色 | 已完成檢查 |
| --- | --- | --- |
| ckc-disposable-01 | etcd、core、CLI、storage plugin | etcd health、CLI、3 workers available、workload 清空 |
| ckc-disposable-02 | worker-2、agent、CNI | nginx lifecycle／HTTP／資源拒絕／清理 PASS |
| ckc-disposable-03 | worker-3、agent、CNI | 同上 PASS |
| ckc-disposable-04 | worker-4、agent、CNI | 同上 PASS |

每台 worker 註冊容量為 2 CPU、2 GiB RAM、10 GiB storage，測試容器使用 1 CPU、256 MiB RAM、1 GiB storage。這是本次 Eru 排程容量，不是 VPS 實際總容量。core／CLI 0.1.5、agent 0.1.3、etcd 3.6.14、CNI 1.9.1；使用已存在的 containerd 2.3.5。下載以 [artifact lock](../artifacts.amd64.lock.json) 的 SHA256 校驗，nginx 以 digest 固定。

三台均依序通過 image cache、deploy、get、exec nginx version、HTTP、access logs、stop（runtime task 消失）、start、再次 HTTP、remove。每次 HTTP 都從容器所在 worker 探測 CNI IP，回應包含 nginx welcome page。重新 start 後 IP 可改變，因此每次從 runtime metadata 重新取得。

各台實際提交 3 GiB memory 或 11 GiB storage 的額外部署，均返回資源不足；沒有產生額外 workload。清理後三台 Eru resource usage 均回到測前零值，core workload list 為空，runtime 的 eru containers／tasks 亦為空。image cache、CNI bridge、安裝檔、metadata 與 ERU 常駐服務保留。

## 原服務與存取邊界復核

- 四台 Docker／containerd 與各自新增的 ERU units 都 active。原 containerd unit 與部署前內容一致；config 的已盤點欄位一致，原 socket 仍 root:root 0660。這不是對所有系統檔案的逐 byte 全機比較。
- 四台有效 SSH policy 仍 `PermitRootLogin no`；原 g1ops alias 的 `onevps-hostctl access-status` 均回報 `ssh_policy=validated`。Docker containers 維持空集合。
- core 僅監聽 01 的 Tailscale 位址:5001；etcd 僅 127.0.0.1:2379／2380；agent API 僅 127.0.0.1:12345。core 的獨立 nft table 將 5001 的來源限於這四台 VPS。
- 從 B 探測四台公網 IPv4 的 2379／2380／5001，12 次 TCP 連線均未成功。此結果限於 B 的觀測路徑及當時狀態，不是全球來源或 IPv6 的完整掃描。
- 每台 worker 的實際 admin keys 檔僅有一行本案 core key；檔案仍 root-owned。所有 owner manifest 追蹤的安裝檔案 SHA256 均吻合。

core 專用 key 及 ckc-only runtime socket 具有 root 等級能力，屬 [已批准計畫](DEPLOYMENT-PLAN.md) 的信任範圍。沒有放寬 g1ops sudo、啟用 root SSH 或重新安裝／重啟既有 runtime。

## 過程中修正的問題

1. core 的 Go SSH 與 B 的 OpenSSH 協商到不同 host key 類型。透過已認證的 admin SSH 讀取 worker 的 Ed25519／ECDSA／RSA 公鑰，比對既有可信 Ed25519 anchor，再生成 core known_hosts；全程保留嚴格 host key 驗證。
2. OneVPS 的 ckc 使用 Match User 專用 `AuthorizedKeysFile`：`/etc/ssh/onevps-personal-admin/ckc.keys`。安裝器現以 `sshd -T -C` 核對，保留原有 keys／owner／mode，只加入 source-restricted core key。早期加入 home authorized_keys 的本案重複行已精確移除。
3. 首次 worker-2 HTTP 檢查早於 nginx entrypoint 完成，當次測試 FAIL 並完成 workload／資源清理。測試器改為有時限的 HTTP readiness retry；後續完整三 worker run 全部 PASS。保留失敗與成功 evidence，沒有把第一次失敗隱去。

## SDD 驗收對照

| ID | 狀態 | 證據與尚缺範圍 |
| --- | --- | --- |
| V01 | PARTIAL | Debian 既有主機的 adapted Profile A 通過；未做空白 Ubuntu 安裝與 30 分鐘重建目標 |
| V02 | PARTIAL | 自有 smoke 腳本完成三 worker 的等價 lifecycle 與 HTTP；沒有逐台原樣執行上游 verify.sh |
| V03 | PARTIAL | 三 worker 本機 CNI HTTP 與 B→公網管理埠探測通過；host-network 私網 HTTP、容器出站 NAT 未測 |
| V04 | PASS | 三台各自記錄 memory／storage 超額拒絕、無额外 workload、remove 後配額回收 |
| V05 | PASS | 四台同版本 apply 一次；保留 nginx ID／runtime PID／HTTP，pod／node／資源不變，20 個 unit 的服務狀態／啟動紀錄不變 |
| V06–V11 | NOT RUN | worker 重灌、失聯、3 次冷重建、quorum、snapshot restore、24h soak 尚未做 |

V05 的證據是本次獨立的穩定叢集重跑測試，不是部署途中修正 SSH 的重試。V01–V03 的原始條件仍有缺口，因此 M1 尚未完整驗收，M2 重建管理尚未達標。

## 後續可執行的工作

`python3 scripts/smoke-lab.py --node worker-2 --verify-reapply` 已於 2026-09-22 10:20:59–10:21:43 UTC 完成，全流程約 44 秒（含建容器、快照、apply、驗證與清理；不是 OS 重建耗時）。自動審查先前拒絕後，owner 再次回覆「批准。」才執行。

- 四台 apply exit 0；維持 1 pod、3 nodes，資源容量及使用量前後完全一致。
- worker-2 nginx workload ID、runtime task PID 與 RUNNING 狀態一致；重跑前後相同 CNI IP 的 HTTP 均成功。
- 四台共 20 個 systemd units（含 Docker／containerd、ERU services／socket）的前後 MainPID、InvocationID、NRestarts、啟動時間與狀態快照一致，未觀察到服務重啟。
- 隨後 nginx stop／start 與 HTTP 通過；超額 memory／storage 被拒絕；測試 workload 清空、配額回到測前值。
- HTTP 為前後取樣，沒有連續請求監測，不能據此宣稱量測到了零停機。此結果僅覆蓋相同版本／配置的一次 apply，不代表升級、配置變更或乾淨重灌收斂。

腳本已保存全部命令、快照與 apply 輸出。詳見 [操作手冊](RUNBOOK.md)。

下一個尚未完成的工作是 M2 的 cluster lock／plan／journal／ownership 清理與 worker 重建操作器；取得 provider reimage 方式並審閱具體範圍後，才進行 worker-4 重裝及三次冷重建。四台規格充足，當前缺口主要是操作器與恢復驗證。

## 私有證據與交付範圍

以下路徑相對專案根，皆被 Git 忽略；raw evidence 含真實位址，不提交到公開儲存庫：

- `private/smoke/20260922T102059Z-b7b2b5.json`：V05 PASS，四台 apply 與服務快照、nginx 保留及清理證據。
- `private/before-reapply-20260922T102058Z/`：重跑前 plan、首次安裝 log 與 final audit 備份。
- `private/smoke/20260922T095025Z-25f5e7.json`：三台完整 PASS，逐命令 alias／argv／exit code／輸出及前後資源。
- `private/smoke/20260922T094911Z-54d3ea.json`：首次 readiness 失敗及成功清理。
- `private/final-audit.json`：最終服務／SSH／listeners／公網探測／node／workload 檢查。
- `private/install-ckc-disposable-*.log`、`private/deployment-plan.json`：安裝與配置紀錄。
- `private/admin-preflight/`：部署前 runtime 基線；`private/verified-host-public-keys.json`：經認證連線取得的 host 公鑰。

公開交付包含 SDD、操作手冊、artifact lock、範例與三個部署／測試 Python 原型。首次部署階段尚未 commit／push；後續 Git 交付與接續方式見 [HANDOFF](HANDOFF.md)。沒有實作或執行 provider reimage、全群 reset 或自動 uninstall。
