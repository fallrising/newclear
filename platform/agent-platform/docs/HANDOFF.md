# 開發接續紀錄 — 2026-09-21

本次停止點：M0 實作與證據已提交，等待換到可使用 KVM 的主機。使用者要求保存進度並合併 PR #15，稍後再執行 MicroVM 驗證。

## 已完成

- SDD 基準：PR #14 已合併。
- 程式基準：PR #15；本次文件新增前的程式 commit 是 `72dcf45b916c77964c69c2a0b04b6a29d73049a4`。
- OpenHands Agent Server 固定版本的 Docker 契約測試、事件 journal 與確定性模型 fixture。
- Cocoon 單節點 SDK probe：固定 OCI claim key、單次 allocation、origin 限制、guest binary 驗證、程序重啟、release／claim-list 核對。
- Guest rootfs Dockerfile：保留 sandbox 的 kernel、initramfs、systemd、silkd、cocoon-agent，加入固定 OpenHands binary 與非 root 使用者。
- KVM preflight：CPU flags、裝置／權限、KVM API version。
- 38 個本機測試、原始映像及 guest rootfs 各 14 項 Docker 檢查通過。
- GitHub CI 在上述程式 commit 通過：[run 35598680689](https://github.com/fallrising/newclear/actions/runs/35598680689)。
- 測試用容器與網路已清理。Guest 映像只在舊機器本機建置，沒有 publish registry；新機器需重新 build。

## 尚未完成

目前仍為 **M0 in progress**，`full_m0_complete=false`。Cocoon data-plane／MicroVM 開機、TTL 到期、實際 VM 停止與資源回收、跨工作區隔離、egress 與故障注入都還需要真實 KVM 主機。M1 平台 API、Web UI 與排程器尚未開始。

舊開發機是 Ubuntu 24.04 的 AMD KVM guest，沒有暴露 `svm`，也没有 `/dev/kvm`。不要只在舊機器安裝套件就視為已解決硬體條件。

## 新機器接續順序

1. Clone／更新 `fallrising/newclear` 的 `main`，進入 `platform/agent-platform`。
2. Python 3.12+ 建立虛擬環境，安裝依賴與執行基本檢查：

   ```bash
   python3 -m venv .venv
   . .venv/bin/activate
   python -m pip install -e '.[dev]'
   make check
   agent-platform-m0 preflight
   ```

3. 依 [KVM 主機準備](KVM-HOST.md) 確認 KVM 能力、安裝 Cocoon／sandboxd／相依元件，建置 guest image，取得真正的 OCI manifest digest，準備單節點私密配置。
4. 按文件執行 `guest-image-smoke` 和 `sandbox-smoke`。若 KVM 主機在遠端，使用文件中的 SSH tunnel；不必搬運舊機器的暫存檔或虛擬環境。
5. 把去除機密的真實主機驗收結果記入 `docs/evidence/`，更新 M0 的 pass／unsupported／fail 與剩餘 gate。不可用 Docker／mock 成功代替 MicroVM 證據。

## 必須保留的契約差異

- `template_digest` 是 promoted snapshot export digest，不是 OCI manifest digest；目前 probe 使用 configured pool／cold OCI claim。
- OpenHands `/interrupt` 只證實 paused；sandbox release ACK 與 claim-list 消失也不能單獨證實 VM 已停止。
- 每次 WebSocket 訂閱的首幀 full_state 快照不屬於持久化 history。
- SDK 0.1.12 wheel 的 sandbox.py 與研究時 source revision 不完全相同；exec timeout 不代表 guest 程序已終止。
- Session／sandbox token 從本機環境或 secret store 提供，不提交到 repository；沒有模型 provider key 需求。

設計見 [SDD](../SDD.md)，驗證命令與證據見 [M0](M0.md)，主機安裝與遠端執行見 [KVM-HOST](KVM-HOST.md)。
