# 固定負載的 client 位置診斷

本規程在執行前固定。已審查的批次化代碼已於 [PR323](https://github.com/fallrising/newclear/pull/323) 合併，merge commit `1f51bfba11904f9be4499e7344d82dcfbc842e87`；[完整交錯矩陣](benchmark-fixture-results-20261009.md) 的效能未通過項目仍開放。這次診斷不改 runtime、workers 預設或驗收門檻，不與既有矩陣合併推論。

## 假設與固定條件

上一輪 client host steal 為 4.51–14.51%，但沒有 client process CPU，不能據此斷言瓶頸。最小比較是固定 server、batching binary 和負載，只換負載產生端。A 為既有獨立 6-vCPU client，B 為另一台獨立 12-vCPU client；兩者 CPU 型號均為 AMD EPYC 7443P。CPU 數不同、同時可能改變 host 排程與路徑，因此結果只用來判斷這個 client/path 組合，不能歸因於 steal 或某一硬體差異。

server 仍是 6-vCPU VM，Docker CPU affinity 0–3、直接 Ethernet、mio、4 workers/4 shards；client 不限制 affinity，兩邊都只有四個 benchmark threads。記錄 CPU、RAM、kernel、路由、六次 ICMP RTT、image identity 與既有資源快照。ICMP RTT 不證明 TCP 吞吐或線路容量。識別主機的資訊只保存在私有原始證據。

固定 binary SHA256：`560e697b7557eec5bc9372f7949362feaf8b9a8ac1a1b0ab5c2d62ca54763ecd`。Server image：`rust@sha256:af306cfa71d987911a781c37b59d7d67d934f49684058f96cf72079c3626bfe0`；client image：`redis@sha256:4fa24486b8bcca8eec45ee0eb166edc674795e53a2b53d1a9ef263eecebaac85`。不並行編譯、profile 或其他本任務負載。

每個觀察重新啟動 server，由該次指定 client 以 c50、四 threads、P32、1M 隨機 key、seed 0 做 10M SET 暖機，再以相同參數做 10M SET 量測。四對的 seeds 為 101–104，同一對使用相同 seed：

| 次序 | client | seed |
|---|---|---|
| 1 | A | 101 |
| 2 | B | 101 |
| 3 | B | 102 |
| 4 | A | 102 |
| 5 | B | 103 |
| 6 | A | 103 |
| 7 | A | 104 |
| 8 | B | 104 |

命令為 `redis-benchmark -h "$SERVER_IP" -p "$PORT" --threads 4 -c 50 -n 10000000 -r 1000000 -P 32 -t set --seed "$SEED" --csv`。較小 request 數的 smoke 僅檢查 runner、採样與清除；其資料獨立保存，不算這八個觀察。

## CPU 視窗及證據

兩邊使用同一個 remote Python controller 與容器 wrapper。wrapper 執行 benchmark 後記錄唯一 exit marker，啟動一個有限時間的 sleep 子程序並 wait，保留 live keeper 與 cgroup。controller 以 cgroup、PID/starttime、父 PID、精確 sleep argv 和存活狀態確認完成階段，才讀 marker 與 cgroup v2 `cpu.stat`；收集後再核對 keeper／sleep 身分並明確清除自身容器。這不需要在負載期間反覆讀 Docker logs，也不依賴停止容器仍保留 cgroup。完整 cgroup CPU 包含 benchmark、keeper 與啟動開銷，不能冒稱精確的單一 PID CPU。負載期間採樣 cgroup 內 Redis PID 與 thread 的 user/system ticks、comm、starttime；將消失、重用或未捕捉的 PID/thread 明列。這些部分視窗不能外推成完整程序成本。

client host `/proc/stat` 的 monotonic 視窗對齊呼叫期間，包含 instrumentation 開銷與其他程序。server 的 process/thread CPU 仍用量測前後快照，視窗包含 SSH 和 client 啟停開銷；CPU/request = user+system ticks 差 / CLK_TCK / 10M。不混用 host CPU、cgroup CPU 或部分 PID CPU。p99 取單一有效 SET CSV；數值必須有限且符合基本範圍。

暖機及量測都保留原始 CSV、stderr、exit、cgroup/PID/thread/host 視窗；每次保留 server log/state、CPU 快照及 checkpoint。另存 protocol/runner/binary/image digest。任何非零 exit、無效 CSV、採樣或清除失敗均停止矩陣並保留失敗資料；不得偷偷替換失敗樣本。controller 不會自動續跑或跳過樣本；中斷後先核對既有 checkpoint 身分及所有 SHA256，人工記錄哪些觀察完成，再以新 namespace／attempt 安排未完成部分。完整八項結果另行審查後公開。

執行前檢查含停止容器的精確 namespace、port 和 firewall；有既存同名資源就拒絕。每個 mutation 前先記 attempted，timeout 仍可能已生效。每項與最終清除獨立處理 server、兩邊 client 容器及兩條精確 peer firewall rule，核對 absence 和 port；其他服務不在清除範圍。

## 預先解讀規則

四對都需同時满足 B 相對 A：QPS ≥ +5%、p99 不更差、server CPU/request ≤ +5%，才支持這個固定 cell 有可重現的 client/path 限制。混合結果不支持這個預先規則，不能統計排除所有 client 影響，也不能斷言瓶頸在 server。初版 keeper 對自身發送 SIGSTOP 的假設在第一個 100k smoke 不成立：benchmark exit 0 後 shell/container 亦退出，cgroup 計數消失。該 smoke 已中止，失敗資料另存且不計入八項正式觀察；採用上述有限 wait 修正後，必須先完成新的 smoke 與清除審查。

四對沒有穩健信賴區間；CSV/exit 0 也不是獨立逐請求零錯誤稽核。

無論結果如何，原有 workers4/1 ≥1.5 與接近單 worker CPU 成本的目标保持。取得支持結果後才規劃新的、另存的受控矩陣；未支持則根據實際 CPU/thread 證據選擇下一個有界診斷，不直接改 spin 次數或 worker 預設。
