# 跨 worker 批次化量測（2026-10-08／09）

批次化降低跨 worker 傳遞的部分 CPU 成本，但本輪沒有證明吞吐全面改善。c50 的四 worker／單 worker 比只有 1.22／1.28；c500 達 1.71／2.04，但四 worker SET 比原版慢 12.5%。原 4 vCPU 私網環境尚未重跑，不能據此宣稱效能驗收完成，也不足以決定預設 workers。

## 環境與方法

- 原版為 `c4777a38774e1275d1212fe2c2a6297b0734f894` 的 Snail；新版為本次批次化實作。兩者 Cargo.lock 與 release 編譯設定相同，Rust 1.88、jemalloc。
- 兩台不同 VPS，AMD EPYC 7443P，各 6 vCPU；server 容器以 `--cpuset-cpus 0-3` 限制可用 CPU，client 4 threads。限制 affinity 不等於獨占 4 vCPU VM，不能消除 host 的干擾。
- Linux 6.12.43；Docker host networking；直接 Ethernet 路徑，無 Tailscale。該路徑使用公開介面，**不是原基準指定的私網**，RAM／CPU／網路環境也不同。
- `RUDIS_IO_URING=0`；workers／shards 分別為 1／1、4／4。每次重啟後先以隨機 key 做 1M SET 暖機，再依 c50、c500 順序，各跑 SET／GET 兩輪。每項 10M requests、1M keyspace、P32，兩輪 seed 分別 101、102。
- 原版與新版分別跑完整矩陣，沒有交錯隨機化。c50 SET 首輪含 keyspace 尚未填滿的成本；原版單 worker 兩輪約 0.547／0.714M req/s，四 worker 約 0.726／0.888M，存在明顯輪間差異。兩輪不足以估計穩健信賴區間。

實跑使用的映像：

- Rust：`rust@sha256:af306cfa71d987911a781c37b59d7d67d934f49684058f96cf72079c3626bfe0`
- redis-benchmark：`redis@sha256:4fa24486b8bcca8eec45ee0eb166edc674795e53a2b53d1a9ef263eecebaac85`

release 執行檔 SHA256：

| 版本 | SHA256 |
|---|---|
| 原版 | `7f5d6f8dc5988dc1ee55b050f6b2a81ca62f9a5d4b9891a0948c8c79f9ddb98f` |
| 批次版 | `560e697b7557eec5bc9372f7949362feaf8b9a8ac1a1b0ab5c2d62ca54763ecd` |

在另一台 client 主機重現每項測試的參數；`SERVER_IP`、`PORT`、`CLIENTS`、`COMMAND`、`SEED` 由測試環境提供：

```sh
redis-benchmark -h "$SERVER_IP" -p "$PORT" --threads 4 \
  -c "$CLIENTS" -n 10000000 -r 1000000 -P 32 \
  -t "$COMMAND" --seed "$SEED" --csv
```

server 在相同 CPU affinity 與網路設定下分別啟動原版／新版：`--bind "$SERVER_IP" --port "$PORT" --workers 1 --shards 1` 與 `--workers 4 --shards 4`。暖機使用上述 client 參數中的 c50、SET、1M requests、seed 0。不要將單 key 或 VPN 路徑結果混入此矩陣。

## 完整前後結果

[32 項逐輪數據 CSV](benchmark-cross-shard-20261009.csv) 保留每輪吞吐、CPU seconds、CPU/request 與平均／最小／p50／p95／p99／最大延遲。下表為兩輪算術平均，吞吐單位 M req/s；CPU/request 單位 μs。

| clients | 命令 | 原版 1w 吞吐／CPU | 原版 4w 吞吐／CPU | 批次版 1w 吞吐／CPU | 批次版 4w 吞吐／CPU | 批次版 4w／1w 吞吐 |
|---|---|---|---|---|---|---|
| 50 | SET | 0.630／1.579 | 0.807／3.110 | 0.637／1.559 | 0.775／2.829 | 1.218× |
| 50 | GET | 0.769／1.281 | 0.988／2.699 | 0.733／1.292 | 0.941／2.673 | 1.282× |
| 500 | SET | 0.677／1.461 | 1.354／2.522 | 0.695／1.387 | 1.185／2.304 | 1.706× |
| 500 | GET | 0.661／1.445 | 1.378／2.516 | 0.677／1.415 | 1.378／2.279 | 2.036× |

四 worker 前後差異：

| clients／命令 | 吞吐變化 | CPU/request 變化 | 原版／批次版 p99（ms，兩輪平均） |
|---|---|---|---|
| 50／SET | −3.92% | −9.04% | 4.031／4.255 |
| 50／GET | −4.83% | −0.94% | 2.843／2.907 |
| 500／SET | −12.46% | −8.62% | 30.711／20.975 |
| 500／GET | +0.06% | −9.44% | 26.351／17.719 |

CPU seconds 取 server process 的 `/proc/<pid>/stat` user＋system ticks 差，再除以 10M 算 CPU/request。CSV 的 CPU percent 以兩次採樣的 wall time 計算；此視窗含 SSH／client 容器啟動與收尾，不能直接當成負載期間利用率，更不能與舊私網的約 360% 等同。

每項 redis-benchmark 都以 exit 0 完成並輸出 CSV。新版 stderr 保存的警告是無法 fetch server CONFIG（既有命令支援限制）；原版未保留對稱的 stderr 檔案。這不是獨立的每請求錯誤計數，不能把完整 CSV 等同於已稽核零協定錯誤。

## 獨立 perf 採樣

在完整矩陣之外另啟動四 worker server，暖機後以 c500、P32、4 threads、隨機 1M keys，順序執行各 20M SET／GET；對 server process 執行 `perf record -e cpu-clock -F 99 -g -p <pid> -- sleep 25`。採樣有開銷，其吞吐沒有混入前述比較。

| named symbol（self samples） | 原版 | 批次版 |
|---|---|---|
| `ShardClient::send_to` | 4.66% | 1.53% |
| `Connection::try_harvest` | 3.14% | 1.95% |
| `LocalReply::try_recv` | 無此方法 | 2.13% |
| `Shard::write_entry` | 9.74% | 12.19% |

原版 7,299 samples、新版 6,257 samples，均無 lost samples。kernel symbols 受限，部分 userspace addresses 未解析，frame-pointer callchain 也不足以可靠歸因；上表只能描述已命名方法的 self sample 比例，不能證明完整跨 worker 成本下降多少。`try_harvest` 的一部分成本移至 `LocalReply::try_recv`，不可只看它自身的下降。

本次採樣沒有把空 `flush` 掃描辨識為主要熱點，因此未據此加入額外 pending flag 或改變 flush／drain 配額。批次化架構與 CPU／延遲改善已有證據；吞吐與原私網的驗收缺口仍須正面處理。
