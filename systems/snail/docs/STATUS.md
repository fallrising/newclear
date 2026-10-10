# rudis 開發狀態

> 最後更新：2026-10-10

已審查的跨 worker 批次化代碼已在 [PR323](https://github.com/fallrising/newclear/pull/323) 合併；效能驗收仍未完成。本輪限定批次化、必要回歸修正與受控效能診斷。M2/M3 的容量實驗仍保留歷史狀態，未在本輪重新驗收。

## 里程碑進度

| 里程碑 | 狀態 | 說明 |
|---|---|---|
| **M0 骨架** | ✅ 完成 | |
| **M1 完整語義 + 多核** | ✅ 完成 | **C10K gate PASS**（1w / 多 w） |
| **M2 承壓層** | 🟡 進行中 | **C100K hold PASS**；單機峰值抬升 |
| **M3 極限** | 🟡 進行中 | completion io_uring；C1M 腳本待實跑 |

## 跨 worker 批次化（2026-10-09）

- 請求／回覆按 worker 分批；每個 message 至多 256 項，每次 inbox drain 至多 16 個 message。key 熱路徑使用 origin 本地 generational reply slot；多 key helper 的最終本地結果仍使用 oneshot。
- 修正 mio 的 spurious readability：沒有讀到資料的 WouldBlock 不代表 EOF。關閉 broadcast 會喚醒 reactor；io_uring 在下一次等待前檢查關閉完成。
- 新增兩 worker／四 shard 的混合 pipeline 回歸：64 個已填入的 key、384 個回覆逐一驗證，包含一般 GET／SET、PING、失敗 SET NX 與 MGET，並確認四個 shard 都有處理請求。`cargo test --locked --release`：最終 mio **45 passed**；實際 io_uring **45 passed**，無 fallback，包含 overload、FIFO、斷線後重連與空閒 multi-key helper 進度。先前首輪批次版本的四個 socket 回歸另有 mio 連跑 20 輪、**80 passed** 的記錄。
- 歷史前後數據保留於[跨 worker 量測](benchmark-cross-shard.md)。後續採可替換且規格明確的環境，[先行規程](benchmark-reproducibility.md)及[新的32項交錯結果](benchmark-fixture-results-20261009.md)已完成；不再等待原測試機資訊。c50 SET／GET scaling為1.137／1.184，未達1.5；c500為1.713／1.851。四worker CPU/request相對原版下降9.63–12.65%，但仍是單worker的1.62–2.07倍，效能驗收未完成。
- 後續交錯 SET 比較共四對：首輪批次版 CPU/request 每對都較低，均值約降 9.5%；吞吐差距有正有負，均值約 −0.9%，未穩定重現首輪順序量測的 −12.5%。兩種暖機方法分開記錄。
- 單獨嘗試省掉遠端 GET／SET 的重複 routing，但 SET CPU 效果不一致、GET 兩對較差，未通過保留標準，已撤回四處實驗 source 修改。最終 runtime 與首輪批次版相同；新增測試、20 項交錯數據及實驗結果說明保留，預設 workers 未改。

## 舊多 worker 基準的更正

[PR #303](https://github.com/fallrising/newclear/pull/303) 已更正早期比較：Tailscale 的 userspace WireGuard 在兩端約各消耗 180% CPU，可能先限制網路／client；未使用 `-r` 的 redis-benchmark 只測一個 key，會集中到一個 shard。兩種結果都不能用來判斷隨機 key 的多 worker 效率。

2026-10-06 改用私網、隨機 1M keys、client 4 threads、每項 10M requests、各兩輪的歷史數據如下；它與本輪替代主機的絕對吞吐不可直接比較。

| workers | c50 SET / GET（M req/s） | c500 SET / GET（M req/s） | server CPU |
|---|---|---|---|
| 1 | 1.05 / 1.14 | 1.05 / 1.08 | 約 100% |
| 2 | 0.85 / 0.90 | 0.96 / 0.99 | 未記錄 |
| 4 | 0.87 / 0.98 | 1.12 / 1.17 | 約 360% |

該次 perf 為 `send_to` 8.8%、`try_harvest` 8.4%，加上 oneshot／mpsc 操作；這是批次化的起因，不是新版的量測結果。

## 歷史 C10K（2026-07-30，預設 mio）

| 閘道 | 結果 |
|---|---|
| Gate hold10K+active64（1 worker） | **PASS** p99 ~1.6ms |
| 同閘道多 worker（2w / 4w） | **PASS** 為主；偶發 p99 噪音 >5ms |
| Peak 256×P16 | 資訊；**~1.17M req/s** |
| Peak 64×P32 | 資訊；**~2.08M req/s** |
| Stress 10K×P16 | 資訊；**~0.36–0.45M req/s** |

## 歷史 `RUDIS_IO_URING=1`（2026-07-30）

- AcceptMulti + eventfd + always-in-flight Recv/Send；ring 32K
- Send 期間可並行 Recv（out_buf freeze segs）
- 1w gate：**PASS** ~2.1ms
- Peak 與 mio 持平：256×P16 ~1.17M；**64×P32 ~2.08M**
- 10K×P16：~0.45M（優於同輪 mio）；尚未達 ~2M@10K / p99&lt;5ms

## 歷史峰值優化（2026-07-30）

- 單 shard 熱路徑跳過 key hash / owner 查詢
- process_input 一次取 now；uring Recv∥Send + CQ burst drain

## 待驗證

1. 使用規格已記錄且可替換的 fixture，依吞吐、CPU/request 和 p99 繼續驗證多 worker 效率；原測試機 identity 不是前提。固定負載的 [client 位置診斷](benchmark-client-placement-results-20261010.md) 已完成八項：四對只有一對符合規則，替換client的穩定改善未獲支持。固定shards4的1w/4w [on-CPU規程](benchmark-oncpu-attribution.md)已先提交，兩次smoke及[停止證據](benchmark-oncpu-results-20261010.md)已保存：recorder收尾修正後exit0，但leaf coverage20/22=90.91%未達95%，正式四項未啟動、歸因inconclusive。下一入口僅離線核對同一pinned libc DSO/build-ID及匹配符號来源，另先寫規程並審查；不重取樣或直接改spin／預設，效能仍PARTIAL。
2. C10K 全活躍吞吐／p99 與 C1M hold 保留為未完成的歷史實驗；本輪未重跑，也未據此宣稱通過。
