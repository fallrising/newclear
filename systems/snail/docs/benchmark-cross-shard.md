# 歷史跨 worker 批次化量測（2026-10-08／09）

批次化降低跨 worker 傳遞的部分 CPU 成本，但本輪沒有證明吞吐全面改善。首輪矩陣的 c50 四 worker／單 worker 比只有 1.22／1.28；c500 達 1.71／2.04，四 worker SET 的兩輪平均比原版低 12.5%。後續交錯比較的吞吐差距有正有負，尚未穩定重現該幅度。原 4 vCPU 私網環境在這些量測中沒有重跑，當時的效能驗收未完成，也不足以決定預設 workers。後續已採[規格明確的可替換環境](benchmark-reproducibility.md)，不再等待原主機資訊；[新的完整矩陣](benchmark-fixture-results-20261009.md)仍有數值門檻未達標。

## 環境與方法

- 原版為 `c4777a38774e1275d1212fe2c2a6297b0734f894` 的 Snail；首輪批次版為 `66ba3f36d139d2309f0c78590a35396d263ca8db`。兩者 Cargo.lock 與 release 編譯設定相同，Rust 1.88、jemalloc。
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

## 首輪完整前後結果

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

## 後續交錯比較：原版與首輪批次版

使用相同的兩個不可變 release 執行檔，在相同替代主機、網路、affinity、四 worker／四 shard、c500、P32、client 4 threads 下跑 ABBA 及 BAAB；A 為原版，B 為首輪批次版。每項重啟 server，以 c50、seed 0 做 **10M 隨機 SET 暖機**，再量測 10M SET；同一對使用相同 seed 101 或 102。較完整的暖機減少首次填入 key 的差異，因此這組資料與首輪 1M 暖機矩陣分開解讀，不替代原私網驗收。

[20 項交錯量測 CSV](benchmark-paired-20261009.csv) 的 `batching-reference` 八列保存這組逐輪數據；其餘列是下節已撤回的 routing 實驗，兩者分開計算。

四對配對結果（B 相對 A）：

| 順序／seed | 吞吐變化 | CPU/request 變化 | p99 變化 |
|---|---|---|---|
| ABBA／101 | +6.30% | −7.53% | −25.04% |
| ABBA／102 | −11.49% | −2.70% | +8.25% |
| BAAB／101 | −3.22% | −11.96% | −8.31% |
| BAAB／102 | +6.30% | −15.80% | −32.34% |

各版四次的算術平均：原版 1.241M req/s、2.494μs/request、p99 28.811ms；首輪批次版 1.231M、2.257μs、p99 24.487ms。吞吐均值差約 −0.86%，CPU/request 約 −9.50%。CPU 成本在四對都較低；吞吐效果則跨過零，不能把首輪 −12.46% 當作已證明的因果退步。這仍是共享 VM 上的小樣本，沒有穩健信賴區間。

八次測量與暖機均 exit 0，雙方 stderr 都只保留既有的 CONFIG fetch 警告。CPU 採樣仍包含 SSH／client 容器啟停視窗，沒有獨立的逐請求錯誤稽核。後續優化必須與首輪批次版單獨比較，不能把兩種暖機方法或版本混成一個平均。

## 未保留的 routing 實驗

在首輪批次版上，單獨將 `apply_hot_get`／`apply_hot_set` 及 `try_local_fast` 的遠端 plain GET／default SET 四條分支改為直接以已計算的 shard ID 呼叫現有 `ShardClient::send_to`，再 `push_async`。假設是省掉 Dispatcher 再次查詢 routing 的成本；沒有改 batch 配額、buffer layout、local／optioned／helper 行為。實驗執行檔 SHA256 為 `f7e64f6e08a7abc7d4fd480d032795ce323b352fb1bd87365efd29ff3ac3970d`。

與首輪批次版在上述 10M 暖機方法下比較：SET 跑 ABBA＋BAAB 共四對，GET 跑 ABBA 共兩對；均為四 worker／四 shard、c500。下表是兩版本各自算術平均的變化，實驗版相對首輪批次版：

| 命令／配對數 | 吞吐變化 | CPU/request 變化 | p99 變化 |
|---|---|---|---|
| SET／4 | +2.40% | −1.38% | −2.91% |
| GET／2 | −10.46% | +5.76% | +33.29% |

SET 的配對 CPU 變化為 −7.73%、+0.96%、−0.31%、+2.14%，並非一致改善；GET 兩對的 CPU 都較高且吞吐較低。這不構成可靠的因果診斷，但已不足以通過「CPU 成本可重現改善、吞吐與 p99 無傷害」的保留標準，因此**四處 source 修改已撤回**。實驗止於此，c50／單 worker 控制組未執行。

實驗的完整測試曾在 mio 與實際 io_uring 各 45 項通過；新增兩 worker／四 shard 的混合 pipeline 覆蓋保留，效能實驗未進入最終 runtime。逐輪 CSV、雙方暖機／測量 stderr 與 server log 均保存。routing 實驗另外記錄 server 各 thread CPU ticks 及 affinity CPU 的 host steal 視窗；CSV 的空 steal 欄位表示早期原版比較未採樣，不代表零。共享主機干擾與採樣視窗限制仍適用，GET 樣本只有兩對，未估穩健信賴區間。

## 獨立 perf 採樣

在完整矩陣之外另啟動四 worker server，暖機後以 c500、P32、4 threads、隨機 1M keys，順序執行各 20M SET／GET；對 server process 執行 `perf record -e cpu-clock -F 99 -g -p <pid> -- sleep 25`。採樣有開銷，其吞吐沒有混入前述比較。

| named symbol（self samples） | 原版 | 批次版 |
|---|---|---|
| `ShardClient::send_to` | 4.66% | 1.53% |
| `Connection::try_harvest` | 3.14% | 1.95% |
| `LocalReply::try_recv` | 無此方法 | 2.13% |
| `Shard::write_entry` | 9.74% | 12.19% |

原版 7,299 samples、新版 6,257 samples，均無 lost samples。kernel symbols 受限，部分 userspace addresses 未解析，frame-pointer callchain 也不足以可靠歸因；上表只能描述已命名方法的 self sample 比例，不能證明完整跨 worker 成本下降多少。`try_harvest` 的一部分成本移至 `LocalReply::try_recv`，不可只看它自身的下降。

本次採樣沒有把空 `flush` 掃描辨識為主要熱點，因此未據此加入額外 pending flag 或改變 flush／drain 配額。批次化架構與 CPU／延遲改善已有證據；本歷史量測的吞吐與環境限制仍需保留；最新替代環境與數值驗收見下節。

## 本輪續作規程

測試資源可替換，後續以已記錄規格的替代fixture進行驗收；不再以尋回原測試機為前提。新的完整32項交錯矩陣依[先行規程](benchmark-reproducibility.md)執行，維持吞吐與CPU效率標準。前述資料與限制保留為歷史；新結果將獨立發布。

新的完整交錯矩陣已執行，結果與限制見[替代fixture結果](benchmark-fixture-results-20261009.md)及其32項CSV；舊結果不刪除、不混入新的方法平均。
