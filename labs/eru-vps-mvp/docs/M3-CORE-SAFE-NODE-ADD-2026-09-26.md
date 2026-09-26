# Pinned core 安全新增 worker 節點（2026-09-26）

## 發現與修正

ERU-014 的 worker-only 安裝階段讓 agent 保持停止，並確認 core 尚未看到 node。重新納管時不能依賴「先 AddNode，再用 node down 補 fence」：pinned projecteru2/core v0.1.5 在 Store.AddNode 寫入 Bypass=false；CLI 的 node down --check 會依節點可用狀態拒絕操作。來源：[core v0.1.5 node store](https://github.com/projecteru2/core/blob/v0.1.5/store/common/node.go)、[CLI v0.1.5 node down](https://github.com/projecteru2/cli/blob/v0.1.5/cmd/node/down.go)。

core patch revision 2 將新節點初始狀態改成 Bypass=true，並新增測試確認回傳節點與持久化記錄都 fenced。已有 lock-context 修正一併保留，因此這是新的同版本 patch artifact；排程仍須由明確 node up 開放。

scripts/eru_node_resume.py 是單次 resume helper：限制 core／worker endpoint 為 Tailscale IPv4、node 為 worker-2 至 worker-4，讀取並比對 node name／endpoint，要求它一直保持 bypass=true，輪詢 agent readiness（available=true），才發出一次 node up，最後讀取確認 available=true、bypass=false。命令失敗或結果不確定時不會重試 node up。此 helper 尚未接到新的 smoke／resume 階段；registration executor 會停在 fenced 狀態，不能把目前階段當成已完成的重灌納管流程。

## 離線驗證

以 upstream.lock.json 固定的 core v0.1.5 commit 和官方 Go 1.27.1 linux/amd64 toolchain，在兩個互相獨立的新 private build 目錄完成驗證。兩邊都重現預期的 lock-context baseline failure，修補後 regression tests、calcium 與 store/common tests、lock tests 及 core build 均通過；產生的 core artifact SHA256 為 0203e3a41c9abf51c35fb52e5224cc796b4ab99b220d610ec9fd5397921072fd，兩個 build byte-identical。摘要 manifest 為 patches/core-v0.1.5-safe-node-add.validation.json，狀態是 verified-not-deployed。原始 log／artifact 保留在 private build 區，不納入 git。

resume helper 有本機 fake-runner 測試，涵蓋等待 fenced node 可用、先失去 fence、ready timeout、endpoint drift，以及 node up 回覆後狀態不確定不得重試。未連 VPS，未部署此 core artifact，未註冊 worker，也未跑 E2E。

## 後續

ERU-014 的 worker registration executor 已完成本機實作：綁定 hash-bound bootstrap plan，核對執行中 core binary SHA、worker identity／容量／labels／健康與其他 workers，再由已驗證的 patched core 新增 fenced node 並啟動 agent；只要 available=true、bypass=true 就停在 `registered-awaiting-smoke`。另提供 read-only reconcile，mutation 回覆不確定時不重播。接下來仍須由既有 core patch operator 受控部署 artifact 並唯讀確認 hash，再完成 smoke／隔離 guard、接上單次 resume helper、inventory／cluster generation commit、host-key 更新及跨階段 recovery。沒有連 VPS，safe artifact 仍 verified-not-deployed；本切片未做 E2E。這與日常 component-reinstall 及 provider console OS reimage 分開驗收，不使用 provider API。
