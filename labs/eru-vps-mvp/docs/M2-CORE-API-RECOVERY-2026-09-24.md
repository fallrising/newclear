# ERU-005：core API 不可用時的實機恢復演練

日期：2026-09-24（UTC）。本紀錄只公開驗收摘要；計畫／journal 原文、health samples、私有 inventory 與 raw evidence 均留在 private/，不納入版本控制。

## 演練範圍

2026-09-24T12:10:48.145822Z，僅停止 ckc-disposable-01 的 eru-core.service，建立 core API 不可用狀態。當時 24h 低頻觀測已自然結束，canary 清理已完成；etcd 健康，ERU runtime 與相關 metadata 為空。沒有停止 etcd、worker、Docker/containerd、SSH 或 Tailscale，沒有重播失敗 deployment plan，也沒有做 blanket reset。

## 執行紀錄

| 階段 | 新 plan／run | 結果 |
| --- | --- | --- |
| core API offline recovery | plan 20260924T121117Z-c37f8ffe；run 同 ID | 來源為既有已完成 core patch run 20260922T145650Z-0106bbd2 的可驗證 backup。Plan 僅限 ckc-disposable-01、無 blocker；run 於 12:14:08Z complete（191 個 journal events）。它不依賴 core API 做前置檢查；恢復後 API 與 workers 驗證成功。 |
| fresh health qualification | 20260924T121838Z-control-health.json（private） | 31 samples、149.7 秒；etcd health failures 為 0，沒有 alarm／journal finding。WAL fsync p99 bucket upper 為 8 ms（60 observations）；backend commit 無 observations，不能據此判定其延遲。此樣本只供有界 patch plan readiness，不是 storage root-cause 結論。 |
| validated patch return | plan 20260924T122221Z-42f8365e；run 同 ID | 獨立的新 core-patch plan，只變更 core host；無 blocker。run 於 12:24:02Z complete（29 個 journal events）；執行中 binary checksum 符合 Go 1.27.1 獨立驗證的 patch artifact，restart 被確認，post-check 通過。 |

兩階段使用不同的新 plan／journal。回復原 backup 只是故障恢復，不代表降版安全；已知含 lock-context bug 的舊 binary 只短暫作 recovery 中間狀態，隨後由新 health-bound plan 回切驗證 patch。

## 結束狀態

- core API snapshot 可讀，三個 worker nodes（worker-2／3／4）皆 available。
- ERU workloads 為 0；各 worker 配額使用為 0，ERU worker runtime containers 為空。
- 從 ckc-disposable-01 count-only 讀取 /eru/workloads/、/eru/deploy/、/eru/processing/，三者均為 0；etcd health 通過。
- core 執行中的 binary 符合驗證 artifact；core 確實 restart。四台受保留服務的前後狀態一致：控制面的 etcd、SSH、Tailscale、Docker/containerd、firewall，以及 workers 的 SSH、Tailscale、Docker/containerd、agents、proxy units 均保留。
- 最終沒有改動 OS、SSH／Tailscale、Docker/containerd、etcd 資料或 worker 元件；沒有使用 provider API。

## 完成邊界與後續

ERU-005 的單次 core service outage 恢復標準已通過。這沒有演練 VM／磁碟消失、etcd 資料損壞、非空 workload 災難恢復或 provider console OS reimage，也不能證明歷史 etcd slow fdatasync 的底層原因已修復。正式 V11 1 req/s、24h 負載驗收與 worker-2／3 實機重裝仍是不同任務。ERU-006 host-network／管理埠隔離驗收為下一項。
