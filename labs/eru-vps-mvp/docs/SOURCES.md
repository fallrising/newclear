# 來源、基線與待驗證缺口

查閱日期：2026-09-21。先閱讀 GitHub README，再下載原始碼核對。文件網站首頁無法透過本次瀏覽工具取得，改讀同 repository 的 `docs/`。所有本案配置、容量門檻、管理 CLI 與驗收流程是設計建議，不是上游已完成的功能。

## 固定來源

| 來源 | 固定版本 | 用於 |
| --- | --- | --- |
| [quickstart README](https://github.com/projecteru2/quickstart/blob/023412becd4202b5b8c5d992552310512a2d6790/README.md) | `023412becd4202b5b8c5d992552310512a2d6790` | 上手流程與元件 |
| [Installation](https://github.com/projecteru2/quickstart/blob/023412becd4202b5b8c5d992552310512a2d6790/docs/installation.md) | 同上 | 主機前提、安裝位置與順序 |
| [Configuration](https://github.com/projecteru2/quickstart/blob/023412becd4202b5b8c5d992552310512a2d6790/docs/configuration.md) | 同上 | 私網、CNI、auth、plugin 設定 |
| [版本變數](https://github.com/projecteru2/quickstart/blob/023412becd4202b5b8c5d992552310512a2d6790/group_vars/all.yml) | 同上 | lock baseline |
| [Makefile](https://github.com/projecteru2/quickstart/blob/023412becd4202b5b8c5d992552310512a2d6790/Makefile) | 同上 | 只有 all/check/lint/up/help；沒有 reset |
| [node registration](https://github.com/projecteru2/quickstart/blob/023412becd4202b5b8c5d992552310512a2d6790/roles/node_containerd/tasks/register.yml) | 同上 | exists 不更新既有 node |
| [node SSH](https://github.com/projecteru2/quickstart/blob/023412becd4202b5b8c5d992552310512a2d6790/roles/node_containerd/tasks/ssh.yml) | 同上 | 只讀 core_host 公鑰；lineinfile 累加 |
| [etcd template](https://github.com/projecteru2/quickstart/blob/023412becd4202b5b8c5d992552310512a2d6790/roles/etcd/templates/etcd.conf.j2) | 同上 | HTTP listener、new cluster 固定模式 |
| [etcd binaries](https://github.com/projecteru2/quickstart/blob/023412becd4202b5b8c5d992552310512a2d6790/roles/etcd/tasks/etcd_binary.yml) | 同上 | 未安裝 etcdutl 到 PATH |
| [CNI template](https://github.com/projecteru2/quickstart/blob/023412becd4202b5b8c5d992552310512a2d6790/roles/node_containerd/templates/eru.conflist.j2) | 同上 | bridge／host-local／NAT，未設 portmap |
| [verify.sh](https://github.com/projecteru2/quickstart/blob/023412becd4202b5b8c5d992552310512a2d6790/verify.sh) | 同上 | lifecycle 有測、HTTP 未測、失敗不自動刪 workload |
| [core engines](https://github.com/projecteru2/core/blob/e19ceb7e09d95bedea3eb0c25bec9308101fecc5/docs/engines.md) | core `v0.1.5` → `e19ceb7e09d95bedea3eb0c25bec9308101fecc5` | containerd SSH、host network、restart、volume 語意 |
| [core node](https://github.com/projecteru2/core/blob/e19ceb7e09d95bedea3eb0c25bec9308101fecc5/cluster/calcium/node.go) | 同上 | remove 拒絕非空 node，清理 resource manager |
| [CLI node](https://github.com/projecteru2/cli/tree/5dcf62419d4867b4604a03238930c7ea16cdc140/cmd/node) | cli `v0.1.5` → `5dcf62419d4867b4604a03238930c7ea16cdc140` | down/up/set/remove/workloads 真實命令 |
| [CLI workload](https://github.com/projecteru2/cli/tree/5dcf62419d4867b4604a03238930c7ea16cdc140/cmd/workload) | 同上 | deploy 會 create；dissociate 僅解除 metadata |
| [CLI spec](https://github.com/projecteru2/cli/blob/5dcf62419d4867b4604a03238930c7ea16cdc140/docs/specs.md) | 同上 | commands/restart/publish schema |
| [etcd recovery](https://etcd.io/docs/v3.6/op-guide/recovery/) | 3.6 文件；非 immutable 頁面 | snapshot、etcdutl、restore 與 revision |
| [etcd reconfiguration](https://etcd.io/docs/v3.6/op-guide/runtime-configuration/) | 3.6 文件；非 immutable 頁面 | 成員替換、learner、existing 模式 |

## 需要以原始碼修正的直覺

1. Repository 的 About 仍提 Docker；檢查的 playbook 實際安裝 containerd，不能照舊 Docker quickstart 設計。
2. `docs/index.md` 說 only core talks to etcd，但 plugin 配置也指向 etcd；本案 firewall 與備份涵蓋 plugins。
3. 文件部分段落只列兩種 node group，但目前還有 cocoon；同一主機只能有一種 Eru engine，本案只用 containerd。
4. Ansible 可重跑不等於 desired-state 完整 reconcile，更不等於 uninstall／reimage。上游未提供 destructive lifecycle。
5. core 可多實例，不表示 quickstart 的 SSH key 授權、client bootstrap 與故障切換已形成完整 HA 安裝。
6. storage plugin 負責資源帳目，不能由 `--storage 1G` 推論已提供跨主機 volume、replication 或資料備份。

## 初次研究時尚未核實

2026-09-22 更新：OS／資源／Tailscale、6 份 release archive SHA256 及 core／cli／agent／etcd version smoke 已核實，見 [實機報告](LIVE-2026-09-22.md)。下列原始清單中的其餘項目仍待驗證。

- 4 台實際 VPS 規格、供應商、OS、架構、region、現役服務與 reimage API 行為。
- 所有 release archive 的 checksum／供應可用性，以及實際 OS 上的整組 runtime 相容性。
- 4 機吞吐、磁碟 IOPS、控制面 restart／失聯行為與 SDD 的 RTO／RPO 指標。
- 真機 Ansible apply／rerun、HTTP、worker reimage、三次冷重建、snapshot restore。
- 上游 resource plugin／agent 的完整內部容錯邏輯；本輪不據此保證自動補足副本。

這些缺口是後續 MVP 驗收項，不應被文件語法檢查或上游既有 CI 視為已通過。
