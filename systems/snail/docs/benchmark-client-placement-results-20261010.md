# 固定負載的 client 位置診斷結果（2026-10-10）

已按先行提交的[規程](benchmark-client-placement.md)完成八項正式觀察，四對比較只有一對符合預先規則；**不支持替代 client 在所有四對都有穩定改善**。這不排除其他 client／路徑影響，也不證明瓶頸位於 server。批次化代碼已在 [PR323](https://github.com/fallrising/newclear/pull/323) 合併，產品效能目標仍開放。

## 方法及資料邊界

固定同一 server、batching binary、4 workers/4 shards、server affinity 0–3、mio，c50 SET／P32／四 client threads／1M 隨機 keys；每項重新啟動 server，由指定 client 做 10M SET 暖機再做 10M SET 量測。A 是既有 6-vCPU client，B 是另一台 12-vCPU client；同 EPYC 7443P 型號、Linux6.12.43+deb13；A RAM 約25.4GiB、B約47.1GiB，直接 Ethernet，兩邊 client 不限制 affinity。A 路由為 on-link，B 經 gateway；六次 ICMP RTT 平均0.444／0.474ms，不能當 TCP 容量測試。CPU數與 host／path 一起改變，不能歸因於單一差異。

- ABBA＋BAAB 的種子配對為 A101 B101 B102 A102 B103 A103 A104 B104。
- 規程先行 commit `b786a7a3`，SHA256 `e3211caecf4accbe69566ace8eefba0cf1d0a981e2b5a428374f34b6afd82a10`；凍結 controller SHA256 `4b98c073da3999f519af517a44042315da307370022cfc6edcd652f25552692e`。binary／image digest 見規程，未改 runtime 或預設。
- 八項及16個暖機／量測原始結果成功，八個 server identity 不同；1003個 raw files 和824個 checkpoint-bound hashes 經 root 與獨立 reviewer 核對。server／兩邊 client 容器、兩條 peer firewall rule 和 port 均已清除，所有20項 cleanup 記錄成功。
- [八項 CSV](benchmark-client-placement-20261010.csv)只保存本方法。小負載 smoke、舊32項矩陣與20項 routing 診斷全部另存；不混成同一平均。CSV 採 LF，與核對後的 LF export 完全相同；第一次 CRLF export 保留，所有欄位與 LF 版一致。

## 四對結果

各項變化皆為 B 相對同 seed 的 A；規則需四對都滿足吞吐≥+5%、p99不更差、server CPU/request≤+5%。

| seed | QPS 變化 | p99 變化 | server CPU/request 變化 | 本對符合規則 |
|---|---|---|---|---|
| 101 | +11.70% | -19.88% | -1.03% | 是 |
| 102 | +0.01% | +1.58% | -0.40% | 否 |
| 103 | -2.27% | +9.54% | +1.68% | 否 |
| 104 | -13.98% | +26.94% | +4.51% | 否 |

## 四項算術平均

p99欄是四個量測p99的平均，不是合併所有請求後的p99。CPU/request單位為μs。

| client | QPS（Mreq/s） | p99（ms） | server CPU/request | client cgroup CPU/request | 部分 Redis PID CPU（100%=一核） | host busy／steal |
|---|---|---|---|---|---|---|
| A | 0.889885 | 3.169 | 2.6645 | 1.6674 | 146.92% | 25.32%／4.17% |
| B | 0.876494 | 3.269 | 2.69475 | 1.5813 | 136.54% | 11.15%／2.17% |

A host busy以6核為分母，B以12核為分母，不能直接將百分比當作相同CPU量：平均約1.519／1.338核。完整client cgroup CPU包含 benchmark、keeper、有限sleep和啟動開銷。Redis PID／thread 僅是100ms採樣捕捉的部分視窗，沒有補齊消失後的CPU；每項捕捉一個Redis identity、idle main和四個active threads，最後一次採樣記錄程序消失。各thread視窗不同，不能要求thread差分總和等於process差分。

## 限制及 runner 修正

server CPU視窗包含 SSH、client容器啟動、收集及清除開銷；約13.43–15.42秒，不能當精確benchmark期間利用率。該視窗server總CPU約174–199%的一核，四個active thread各38.8–54.8%；client部分thread各31.1–41.3%。這些on-CPU數字沒有證明單thread飽和，也不能排除等待／排程／網路限制。server affinity steal約0.20–0.62%；A host steal3.05–6.88%，B1.01–3.68%，包含其他程序及不同核心數，不證明因果。

初版keeper的第一個100k smoke在benchmark exit0後失去PID與cgroup；runner正確拒絕該觀察、保留raw且完成清除。修正為有限sleep子程序＋wait，核對精確PPID／argv／cgroup／PID identity／marker及存活狀態後讀計數。修正版16項本機fixtures通過，再完成八項100k Docker smoke及獨立證據審查，之後才執行本正式cohort。所有版本與失敗資料保留，不把smoke數字當效能樣本。

16個正式warmup／measurement的CSV、exit、唯一marker及最後client log/state collection均成功；server未退出或OOM。這不等於獨立逐請求零錯誤稽核。只有四對，沒有穩健信賴區間；四對規則未獲支持不能統計排除所有client影響。本輪只有4w，沒有新的1w控制，不能更新workers4/1 scaling。[前一矩陣](benchmark-fixture-results-20261009.md)的c50 scaling1.137／1.184及CPU成本1.62–2.07倍單worker仍未解除，不放寬1.5目標或改預設。

## 下一個有界入口

先另寫方法，再做c50 SET的server on-CPU成本歸因；固定client A、同server／binary／image／P32／四clientthreads／1M keys／10M暖機＋量測／affinity0–3／mio，只比較1w/4shards與4w/4shards，順序1、4、4、1，配對seed101/102。保持shard數可減少單shard快路徑的混淆；它不是原1w/1shard驗收基準。

保存低頻、可符號化的user/kernel callchains、對齊thread CPU及observer開銷，與本cohort及驗收吞吐資料分開。事前成功條件：同一cost family在兩對4w都呈較高估計CPU/request，且占4w on-CPU samples至少15%；leaf符號覆蓋≥95%、lost samples<1%。不達條件就以inconclusive停下，不直接改spin或worker預設。這個入口只回答額外CPU成本，不會定位off-CPU等待或證明吞吐瓶頸；本輪尚未執行。
