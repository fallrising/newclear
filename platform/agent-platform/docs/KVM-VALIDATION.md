# M0 真實 KVM 驗收 — 2026-09-21

**M0 的五項 gate 已在本次固定測試配置通過。** 匯總見 [gate report](evidence/m0-gates-2026-09-21.json)。範圍是 Linux amd64、單節點、`large`（4 vCPU／4 GiB）、`net=none`、vsock HTTP proxy；不是 production ready，也沒有完成 M1 平台 API／UI。下一個里程碑為 M1。

## 環境與版本

AMD Ryzen 7 PRO 8700GE，8 cores／16 threads、約 61 GiB RAM，Ubuntu kernel `6.8.0-139-generic`，KVM API 12。管理員安裝主機工具並授予 KVM 權限後，使用上游支援的 systemd user service／delegated cgroup v2 執行 Cocoon 與 sandboxd，未再次要求 root daemon。

| 元件 | 實測版本 |
| --- | --- |
| OpenHands Agent Server | 1.49.2／`856d99d48e4b11c70c5f1cab21e7830570dbc324` |
| Cocoon | 0.6.7／`d7dd9a698c1d55c5685c5d4b743ac1413d86e87a` |
| sandboxd | 0.1.12／tag `de42fd50be5cdbfaaa6ddf890081566edb503d3c` |
| Python SDK wheel | `cocoonstack-sandbox==0.1.12` |
| Cloud Hypervisor | cocoonstack fork 54.0.0／`36eea016b3f485d0ac866dbc81b267505197e1fc`；binary SHA-256 `ec3180e5aaa6198db8f6e04f10fb3878d283dc25667cf0ef32286f214adf3cbb` |
| erofs-utils | 1.8.10／`51b5939b5f783221310d25146e6a2019ba8129b6`，LZ4HC tar conversion 與解出內容已測 |
| qemu-img | 8.2.2 |
| Guest OCI manifest | `sha256:349579c9197fff1b95f24cc8734de25948e32ee804c2db6d1347dc0b1eaf9b6e` |

Guest 由現有 pinned Dockerfile 本機建置，再推送至 `127.0.0.1:15000` 的短期 registry。以 registry manifest 原始 bytes 核對 digest，並在 Cocoon store／VM record 核對同一 digest。[原始 manifest](evidence/guest-oci-manifest-2026-09-21.json) 的 SHA-256 即上表 digest；它不是 Docker image config ID，也不是 promoted snapshot digest。此 registry 已清理，`localhost:15000/...` 不是持續可拉取的公開映像。

測試 node 使用新的私密資料目錄、loopback listener、`warm=0`、`max_claims=4`，整個 user service 上限 24 GiB／8 CPU。各 VM 的 `cpu.max=400000 100000` 已觀察，guest 實際看見 4 CPUs／4030624 KiB RAM。Cocoon 的 per-VM CPU burst 使用預設值，quota 是平均上限，不宣稱任意短窗口完全無 burst。

配置範本：[Cocoon](evidence/kvm-cocoon-config-2026-09-21.json)、[sandboxd（token 已刪除）](evidence/kvm-node-config-2026-09-21.json)。node 範本包含專供負向驗收的 loopback allow rule，不應當作 production allowlist。來源實作的 fingerprints 見 [probe source hashes](evidence/kvm-probe-source-sha256-2026-09-21.json)。

## Gate 與能力

| M0 gate | 結果與證據 |
| --- | --- |
| Template／boot／resources | pass：實際 guest boot、固定 binary SHA、readiness、相同 OCI digest、guest CPU/RAM 與 host CPU cgroup；[sandbox](evidence/kvm-sandbox-2026-09-21.json)、[lifecycle](evidence/kvm-lifecycle-2026-09-21.json) |
| REST／WebSocket relay | pass：經真實 `proxy_port` 完成 auth、run、replay 去重、interrupt／resume 與 guest 程序重啟接續；[sandbox](evidence/kvm-sandbox-2026-09-21.json) |
| Workspace／egress isolation | pass：兩個 live VM 同名檔案互不覆蓋、host marker／Docker socket 不可見、兄弟 token 被拒；預設無出站、HTTP/TLS allow 與 403 deny、獨立 IP guard、限定範圍 secret scan；[lifecycle](evidence/kvm-lifecycle-2026-09-21.json)、[default deny](evidence/kvm-default-deny-2026-09-21.json)、[egress](evidence/kvm-egress-2026-09-21.json) |
| TTL／allocation reconciliation | pass：20 秒 TTL 前可用、到期後自動回收；真實 allocation 成功後在 SDK 邊界注入 timeout，只有一次 allocation，依 claim_ref 找到一個 claim 並以 operator release 清理；[lifecycle](evidence/kvm-lifecycle-2026-09-21.json)、[預期失敗的 lost-reply probe](evidence/kvm-lost-reply-2026-09-21.json) |
| Stop／resource release | pass：長命令執行時 release，核對原始 PID＋start-time 消失、VM record、runtime directory／COW disk 與 CPU scope 均移除；另一個 VM 繼續可用。TTL 與故障回收也作同樣核對；[lifecycle](evidence/kvm-lifecycle-2026-09-21.json)、[最終清理](evidence/kvm-cleanup-2026-09-21.json) |

`lost-reply` 個別 report 的 `sandbox_contract_passed=false` 是故障注入預期結果，保存未知配置的待對帳狀態；外層 lifecycle report 記錄實際對帳／回收，沒有把 timeout 當成功。每個 probe 仍固定 `full_m0_complete=false`，只有核對各獨立證據後的 gate report 宣告本次範圍完成。

| 能力 | 判定 |
| --- | --- |
| pause／resume | pass；OpenHands interrupt 表示 paused |
| 取消 busy run 的環境 | pass；以 sandbox release 加獨立 VMM／資源消失證據成立 |
| REST history／WS replay／程序重啟接續 | pass；首幀 full_state 不寫入持久 history |
| `interrupt` 單獨證明 cancelled | unsupported；不得據此釋放容量 |
| exec timeout 自動終止 guest command | adapter 不宣告支援；發布 wheel 與研究 source 有差異，需顯式 kill／release |
| lease renewal、任意工具中途 exactly-once resume、VM checkpoint resume | 此 adapter 不宣告支援；本次沒有驗證 |
| bridge／CNI NIC egress、HTTPS interception、DNS rebinding／redirect 對抗、真實 provider | 本次未驗；後續 M2／M3／M4 依各自驗收補足 |

Egress 的 localhost 負向案例先從 host 取得測試端點 200，確認端點確實可用，再讓 guest 透過 proxy 存取。雖然 domain/port rule 明確 allow，IP guard 仍回 502，server request count 維持唯一的一次 host control request。其他 forbidden host／method／port 與 metadata／control-plane 案例回 403，不把一般 timeout 當 policy pass。

Synthetic canary 只存在 host secret store，plaintext example.com GET 的 audit 確認 injection；guest 僅取得 secret 的 hash 作檢查。掃描範圍是環境、`/home/agentprobe`、`/tmp`、`/var/log` 中不超過 5 MiB 的 regular files；13 files 已掃、1 file 跳過，沒有找到 node token／canary。這是該 fixture 的結果，不是完整 filesystem／memory attestation。TLS CONNECT 不宣稱有 HTTP method filtering 或 secret injection。

## 重跑

先依 [KVM-HOST](KVM-HOST.md) 準備專用空 node、固定 OCI digest、私密 token 與本機 Cocoon config；`M0_ROOT` 表示 repo 外 0700 的本機測試目錄，需自行設定。先跑既有 `sandbox-smoke`，確認 node ready／golden 可用，再以主機可讀取該 node 的 usage journal 和 `/proc`／cgroup 執行：

```bash
python -m agent_platform_m0.kvm_lifecycle \
  --origin http://127.0.0.1:7777 --template "$GUEST_TEMPLATE" \
  --cocoon-config "$M0_ROOT/cocoon.json" \
  --sandbox-data-dir "$M0_ROOT/sandboxd" \
  --output .artifacts/kvm-lifecycle-new
```

此工具只允許開始時沒有 live claim／VM 且 warm target 為 0 的專用 node。它最多同時使用兩個 `large` guest；失敗時只清理自己的 handle／claim_ref，不移除陌生 VM。

Egress probe 需要上述 node 範本的兩個 allow rules、`egress_internal_allow` 空值、`audit_log=true`、環境 secret `M0_EGRESS_CANARY`。用 `secrets.token_urlsafe(48)` 分別產生 node token 與 canary（各 64 URL-safe characters），保存在 repo 外 0600 檔案；launcher 從檔案讀入 node 環境，不將值放進 shell history。僅把 canary 的 SHA-256 設為 `CANARY_SHA256`：

```bash
python -m agent_platform_m0.kvm_egress \
  --origin http://127.0.0.1:7777 --template "$GUEST_TEMPLATE" \
  --cocoon-config "$M0_ROOT/cocoon.json" \
  --sandbox-data-dir "$M0_ROOT/sandboxd" \
  --sandbox-config "$M0_ROOT/sandboxd.json" \
  --canary-sha256 "$CANARY_SHA256" \
  --output .artifacts/kvm-egress-new
```

兩個 probe 從 `SANDBOX_API_TOKEN` 讀取 operator token；output 必須是新目錄。Egress probe 使用 `127.0.0.1:18999` 作本機 control server，並會向 public example.com 發出無真實憑證的 GET。測試模型仍是確定性 fixture，無 provider key。

本次 user service 使用 `Delegate=yes`、`DelegateSubgroup=supervisor`，Cocoon 的 `cgroup_parent` 設為該 service 下的 `vms`。保留 `cni_conf_dir=""`／`cni_bin_dir=""`、`net=none`，透過 `sg kvm` 讓已存在的 session 使用新加入的裝置群組。這個模式沒有 VMM network-namespace quarantine；sandboxd 啟動時的 nftables orphan-sweep 權限 warning 已記錄，對本次未建立 TAP/nft rule 的 none lane 不影響，不據此宣告 NIC lane 可用。配置依據：[Cocoon CPU isolation](https://github.com/cocoonstack/cocoon/blob/d7dd9a698c1d55c5685c5d4b743ac1413d86e87a/docs/vm.md#cpu-isolation-cgroup-v2)。

## 清理與後續

結束時 claim／VM 數均為 0，已停止專用 user service、移除其 cgroup，刪除短期 registry container／volume。保留本機 guest image、開發虛擬環境與私密原始測試檔，供追查與重跑；不表示有 VM 繼續執行。主機工具是 operator 已安裝的依賴，沒有解除安裝。

45 個本機 tests 與 lint／format 通過；原始映像和 guest 各 14 項 Docker checks、真實 sandbox 19 checks，以及上述硬體 cases 均已執行。CI 仍只執行單元／Docker checks，不能取代本文件的硬體證據。M1 尚未開始。
