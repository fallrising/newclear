# ERU-014 重灌前節點摘除器（2026-09-26）

本紀錄交付人工 OS 重灌的 ERU-side preparation 階段，**只做本機 fake-operator 驗證，沒有連 VPS、沒有建立實機 intent／receipt，也沒有呼叫 provider API**。不屬於日常 ERU 元件清理重裝；OS reimage 仍是 owner 在 provider 控制台的後備操作。

## 執行契約

`rebuild-node --mode provider-reimage` 計畫仍保持 `executable: false`。計畫另外輸出 `reimage_preparation.executable` 與 blockers；只有該前置 gate 全空時，之後才能由獨立 `prepare-reimage --plan ... --sha256 ...` 執行一次。此命令不是 plan 的通用 `execute`，也不能執行 provider API、OS 安裝或後續 worker bootstrap。

執行前會重核 plan hash、固定 inventory／專案輸入／cluster generation／intent SHA，並重讀四台 host 與 Eru membership。etcd、Eru 一致性、target 身分、target ERU workloads／containers／tasks／配額、Docker containers、SSH/Tailscale/Docker/containerd 服務或現有 fence 只要不符合即拒絕。目標必須先由 owner 遷移完 ERU workloads；任何 Docker workload 都要求獨立 ownership／遷移審閱。

通過 preflight 後，journal 會先落盤，再由 `ckc-disposable-01` 發出唯一一次 `node down <target>`，並以 `node get` 確認 Bypass。之後只在綁定的 worker alias 停止 `eru-agent.service`；SSH、Tailscale、Docker、containerd 必須仍為 active。停止後再從 aliases 唯讀核對 host 身分、ERU/Docker runtime 為空及 cluster workload/node 狀態，摘除前再核對一次，最後由 `ckc-disposable-01` 移除精確 node registration 並確認該 node 已不存在、其他 node／pod／workload 未變。journal 停在 `status=prepared, stage=awaiting-owner-console-reimage`，不會自動 `node up`。

所有 B→VPS SSH 都透過 `ckc-disposable-01`～`04` aliases；遠端修改只對 core alias 與 plan 綁定的 worker alias 發送。發生 timeout 或回覆遺失時，不重試原命令、不摘除更多狀態、不自動解除 fence。`reconcile --run` 對此 journal 只讀 core membership／health，不連 worker，也不重播命令；依 journal 與觀測明確規劃恢復。

`record-reimage-receipt` 現在還要求同 plan hash 的 preparation journal 成功完成、已觀測 fence／agent stop／runtime empty／registration absent，並檢查 journal 命令只走 core 與 bound worker aliases。後續 receipt、帶外 host key 與 `verify-reimage-host` 仍只是重灌後前置，不能單獨重新納管。

## 後續仍未完成

目前沒有 worker-only 遠端安裝器、agent re-registration、target nginx／HTTP smoke、重新開放排程或這些階段的恢復執行器。此 preparation command 尚未在 VPS 使用；正式驗收仍延後到本機開發收尾後。不要把一次元件重裝或此處的 fake 測試算成 OS reimage 通過。

本輪新增 fake operator 覆蓋成功摘除、plan/hash/runtime drift、既有 fence、target Docker／ERU runtime blocker、fence 與 remove 回覆遺失不重播、read-only reconcile，以及 receipt 必須依賴完成 preparation journal。實機 inventory、credentials、owner intent／receipt 與 raw evidence 均未加入 repo。
