# M0 KVM 測試主機準備

## 先處理硬體能力

2026-09-21 開發機診斷：Ubuntu 24.04／AMD EPYC-Milan，`hypervisor` flag 有、`svm` flag 無、`/dev/kvm` 無。這表示目前 VM 沒有暴露所需的硬體虛擬化能力。套件安裝不能取代宿主機設定。

需要 operator 選擇一項：在目前 VM 的宿主平台啟用 nested virtualization 與 CPU passthrough，或提供另一台 Linux amd64 KVM 測試主機。具體操作取決於 Proxmox／libvirt／雲端平台；不要在不知道宿主平台時卸載其 KVM 模組。完成後，在測試 VM 執行：

```bash
rg -o '\b(vmx|svm)\b' /proc/cpuinfo
ls -l /dev/kvm
agent-platform-m0 preflight
```

`preflight` 會實際開啟裝置並讀取 `KVM_GET_API_VERSION`（預期 12）。`kvm_ready=true` 只代表可使用 KVM API，不代表 Cocoon 或 guest 已通過。

設定依據：[Linux 官方 nested KVM 文件](https://docs.kernel.org/virt/kvm/x86/running-nested-guests.html)。硬體準備完成後，agent 可在同一台機器或透過 SSH tunnel 執行測試。

## 主機套件與服務

以下是這個 M0 切片的安裝基準，仍待真實 KVM 整合驗證；使用獨立測試主機與新的 sandboxd data directory。

| 元件 | 版本／用途 |
| --- | --- |
| cocoon | v0.6.7，tag revision `d7dd9a698c1d55c5685c5d4b743ac1413d86e87a` |
| sandboxd | v0.1.12，tag revision `de42fd50be5cdbfaaa6ddf890081566edb503d3c` |
| Cloud Hypervisor | Cocoon 支援的 v54+；使用 Cocoon doctor 核對相容性 |
| erofs-utils | **>= 1.8**，OCI layer 轉換；不能假設 Ubuntu 預設套件已符合 |
| e2fsprogs | `mkfs.ext4`，VM 可寫磁碟 |
| qemu-utils | `qemu-img`，Cocoon 的映像工具 |
| guest boot files | 本項 guest image 中的 `/boot/vmlinuz-sandbox` 與 `/boot/initrd.img-sandbox` |
| Python | 開發端 3.12+；SDK 以 `pip install -e '.[dev]'` 安裝，不需在宿主機建置 Go／Rust |

預設 probe 使用 sandbox `large`（4 vCPU／4 GiB）。主機還需容納 OS、golden template 與 claim 的額外開銷；此數字不是整台主機最低 RAM 的保證。`--size medium` 是 2 vCPU／1 GiB，尚未測過 Agent Server 的記憶體裕量。

在準備好的主機下載固定版 binary 並驗 checksum（以下 amd64）：

```bash
set -eu
mkdir -p /tmp/agent-platform-install/cocoon /tmp/agent-platform-install/sandbox
cd /tmp/agent-platform-install/cocoon
curl -fLO https://github.com/cocoonstack/cocoon/releases/download/v0.6.7/cocoon_0.6.7_Linux_x86_64.tar.gz
curl -fLO https://github.com/cocoonstack/cocoon/releases/download/v0.6.7/checksums.txt
sha256sum --check --ignore-missing checksums.txt
tar -xzf cocoon_0.6.7_Linux_x86_64.tar.gz
sudo install -m 0755 cocoon /usr/local/bin/cocoon

cd /tmp/agent-platform-install/sandbox
curl -fLO https://github.com/cocoonstack/sandbox/releases/download/v0.1.12/sandboxd_0.1.12_Linux_x86_64.tar.gz
curl -fLO https://github.com/cocoonstack/sandbox/releases/download/v0.1.12/checksums.txt
sha256sum --check --ignore-missing checksums.txt
tar -xzf sandboxd_0.1.12_Linux_x86_64.tar.gz
sudo install -m 0755 sandboxd /usr/local/bin/sandboxd
```

每一步成功後才進入下一步，checksum 不通過時不能安裝。Cloud Hypervisor、erofs-utils 與 host 配置依 [Cocoon installation](https://github.com/cocoonstack/cocoon/blob/d7dd9a698c1d55c5685c5d4b743ac1413d86e87a/docs/install.md) 準備。`cocoon-check` 的檢查模式可用於診斷；其 `--fix`／`--upgrade` 會改動主機網路、sysctl、權限或安裝套件，應由 operator 在測試主機審閱後執行。本專案不自動執行這些主機修改。

## Guest 映像

`guest/Dockerfile` 以 digest 固定的 sandbox Python rootfs 保留 kernel、initramfs、systemd、cocoon-agent、silkd，加入固定 OpenHands binary 與 UID 2000 的 `agentprobe` 使用者。沒有 baked session key 或 provider key。

```bash
cd platform/agent-platform
docker build -t newclear-agent-m0:local guest
agent-platform-m0 guest-image-smoke --image newclear-agent-m0:local --output .artifacts/guest-check
```

若本機 Docker 沒有 Buildx，可在 `docker build` 前設 `DOCKER_BUILDKIT=0`。本次已在 Docker 中通過 rootfs 的 14 項 Agent Server 檢查；尚未證明它能以 MicroVM 開機。證據見 [guest report](evidence/guest-docker-2026-09-21.json)。

後續需把此映像提供給測試主機可讀取的 registry／Cocoon image store。本次只有本機 build，沒有自動 publish。`sandbox-smoke --template` 要求 **OCI manifest digest**（`registry/path@sha256:…`），不能使用 tag 或 Docker inspect 的 image config ID。取得真正 manifest digest 後，由 operator 設 `GUEST_TEMPLATE` 並透過 Cocoon 匯入／拉取；不要填寫虛構 digest。

將同一 guest 的 `/boot` 檔案安裝到主機相同路徑，並依 [sandbox deployment](https://github.com/cocoonstack/sandbox/blob/de42fd50be5cdbfaaa6ddf890081566edb503d3c/docs/deploy.md) 先確認 Cocoon 能啟動它。Kernel、silkd、sandboxd 的組合仍需實測；report 不會因 Docker build 成功而將 boot gate 關閉。

## 單節點 sandboxd 配置與連線

配置下列欄位，將 `api_token` 設為主機上產生的隨機值，把 `${GUEST_TEMPLATE}` 換成上述 digest reference。實際配置與 token 檔案放在 repository 外並設權限 0600；以下是需要填值的範例，不能原樣啟動：

```json
{
  "listen": "127.0.0.1:7777",
  "advertise_addr": "127.0.0.1:7777",
  "client_advertise": "http://127.0.0.1:17777",
  "data_dir": "/var/lib/agent-platform-m0/sandboxd",
  "cocoon_bin": "/usr/local/bin/cocoon",
  "restore_mode": "mmap",
  "no_direct_io": true,
  "release_delay_seconds": 0,
  "api_token": "GENERATE-A-RANDOM-TOKEN-LOCALLY",
  "pools": [{"template": "${GUEST_TEMPLATE}", "net": "none", "size": "large", "warm": 0}]
}
```

由 operator 啟動 `sudo sandboxd -config /path/to/private-config.json`。不開 mesh、preview 或 egress，也不暴露 daemon 到公網。範例使用 SSH tunnel 的 client origin；若直接從主機連 `:7777`，`client_advertise` 必須相應改成 `http://127.0.0.1:7777`。

開發端建立 tunnel（`kvm-host` 是 operator 提供的 SSH host alias）：

```bash
ssh -N -L 127.0.0.1:17777:127.0.0.1:7777 kvm-host
```

另一個終端透過本機 secret store 或受保護檔案設定 `SANDBOX_API_TOKEN`，不要將值貼到聊天、CLI 參數或 PR。執行：

```bash
agent-platform-m0 sandbox-smoke \
  --origin http://127.0.0.1:17777 \
  --template "$GUEST_TEMPLATE" \
  --output .artifacts/first-kvm-run
```

HTTPS origin 也可使用，憑證必須可驗證。SDK wrapper 只允許指定 origin；HTTP redirect、placement redirect 和不同 owner origin 都會失敗，不會把 bearer key 轉送到其他主機。`client_advertise` 必須與 `--origin` 一致。

## 結果如何判讀

- `sandbox_contract_passed=true`：此次 claim、binary／固定 OCI claim key／lease、REST/WS、guest 程序重啟後接續、release ACK 與 claim-list 檢查通過。
- `guest_process_restart_*` 只表示 Agent Server 程序重啟，不是 VM 重啟或 checkpoint restore。
- 配置 POST timeout／未知回應時，不重試建立；報告保存 claim_ref 與可見 matching claims，交由 operator 依主機 journal 核對。沒有 claim token 時不會假裝完成 release；TTL 是回收上限之一，不是已清理的證據。
- `vm_removal_confirmed=false`、`full_m0_complete=false` 保留至獨立的 VM 停止、TTL 到期、跨工作區隔離、egress 正反案例與故障注入證據完成。release ACK／claim-list 消失不能單獨關閉這些 gate。

SDK 0.1.12 的 `client.py` 與研究 revision 一致，`sandbox.py` 不一致：發布 wheel 尚未包含研究 commit 中的 exec-timeout kill 和 proxy accept polling 修正。本切片使用發布 wheel 實測 control-plane HTTP，結束 proxy 時主動 shutdown listener；exec timeout 不能當作程序已終止的證據。完整 data-plane／MicroVM 的 wire 行為仍待真實主機測試。

`template_digest` 是 promoted snapshot export 的內容雜湊，**不是 OCI manifest digest**；configured pool／cold image claim 通常沒有這個欄位。本 probe 僅使用後兩者，核對 claim-list 中完整的 template/net/size/claim_ref，再驗證 guest binary。若收到 promoted digest 會拒絕使用。這仍不是 guest rootfs 的完整 attestation，boot/template gate 保留。語意依據：[sandbox claim API](https://github.com/cocoonstack/sandbox/blob/de42fd50be5cdbfaaa6ddf890081566edb503d3c/docs/sandboxd-api.md)。
