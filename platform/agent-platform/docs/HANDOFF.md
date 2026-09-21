# 開發接續紀錄 — 2026-09-21

本次停止點：**M0 的五項 gate 已在真實 KVM 的固定 none-lane 配置通過，下一步為 M1。** 原始程式基準是 PR #15 合併後的 `aafd24d`；新增實測工具、證據與文件位於 `agent/agent-platform/m0-kvm` 分支。完整結果見 [KVM 驗收](KVM-VALIDATION.md) 與 [gate report](evidence/m0-gates-2026-09-21.json)。

## 已完成

- 已完整讀取前一版 handoff，從 current main 建立獨立 worktree `/home/ckc/test/codex/newclear-agent-m0`。
- 管理員完成 Cocoon／sandboxd／Cloud Hypervisor／EROFS／qemu-utils／guest boot files 安裝與 KVM 權限；實際 KVM API 12 可用。
- 在 systemd delegated user service 中執行真實 Cocoon／sandboxd；無需額外 sudo。固定版本與配置見 KVM 驗收。
- Guest 本機重建，透過 loopback registry 取得真正 OCI manifest digest，再由 Cocoon 拉入獨立 store。
- 真實 Agent Server 19 項 sandbox checks 通過：REST／WS、auth、replay、interrupt/resume、程序重啟後接續、重複 release。
- 兩個 MicroVM workspace／token 隔離、實際 CPU/RAM、20 秒 TTL 前後、busy VM release、allocation 成功後 SDK timeout 注入／對帳通過。
- 以 PID＋start-time、VM record、runtime directory／COW disk 和 CPU cgroup 四種證據核對回收，未只依賴 release ACK／claim-list。
- None-lane egress 的 HTTP/TLS allow、host/method/port/metadata/control-plane deny、private-IP guard 與限定範圍 canary scan 通過。
- 新增可重跑的 `kvm_lifecycle`／`kvm_egress` modules；45 tests、lint／format，以及兩組各 14 項 Docker checks 通過。
- Test claims／VMs 歸零，專用 runtime service／cgroup 與短期 registry container／volume 已清理；保留本機 guest image、venv 與私密原始 artifacts。

## 下一步

1. 依 [SDD](../SDD.md) 的 M1 切片開發 API/Postgres/schema、operator login、queue、fake adapters、UI 骨架及 AT-01 垂直驗收；目前尚未實作這些功能。
2. M1 可從 fake adapters 開始；需要重跑真實 KVM 時依 [KVM-HOST](KVM-HOST.md)／[KVM 驗收](KVM-VALIDATION.md) 重建專用配置。暫存 registry 已移除，不能假設 `localhost:15000` 仍可拉取。
3. M0 的通過範圍是單節點 Linux amd64、`large`、`net=none`／vsock proxy。Bridge/CNI、HTTPS interception、DNS rebinding／redirect 對抗、任意工具中途恢復、VM checkpoint resume、真實 provider 與 production 部署仍須按後續 milestone 驗證。
4. 單一 probe report 保留 `full_m0_complete=false`；本次 gate report 核對跨 probe 的獨立硬體證據後為 `true`。不要更改既有保守回報語意。

## 必須保留的契約差異

- `template_digest` 是 promoted snapshot export digest，不是 OCI manifest digest；目前 probe 使用 configured pool／cold OCI claim。
- OpenHands `/interrupt` 只證實 paused；sandbox release ACK 與 claim-list 消失也不能單獨證實 VM 已停止。
- 每次 WebSocket 訂閱的首幀 full_state 快照不屬於持久化 history。
- SDK 0.1.12 wheel 的 sandbox.py 與研究時 source revision 不完全相同；exec timeout 不代表 guest 程序已終止。
- Session／sandbox token 從本機環境或 secret store 提供，不提交到 repository；沒有模型 provider key 需求。

設計見 [SDD](../SDD.md)，驗證命令與證據見 [M0](M0.md)，主機安裝與遠端執行見 [KVM-HOST](KVM-HOST.md)。
