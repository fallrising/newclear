# 可替換環境的完整交錯量測結果

本輪先提交[規程](benchmark-reproducibility.md)，再依凍結的runner／binary執行完整32項矩陣；量測於2026-10-09 UTC進行（新加坡10月9日晚至10月10日凌晨）。所有8個cell完成、warmup／量測／cleanup成功，保留逐项原始CSV、stderr、serverlog/state、CPU與環境快照、檔案SHA256和可恢復檢查點。

低併發仍未達1.5倍標準，CPU效率也未接近單worker；因此**效能驗收仍未完成**。本輪不再以找回原測試主機為前提，而以規格明確的替代fixture檢查；更換環境不放寬數值門檻。

## 環境與資料邊界

- 獨立server/client各6vCPU、AMD EPYC7443P、約25.4GiB RAM、Linux6.12.43+deb13；server CPU affinity0–3，client四threads，直接Ethernet、無VPN。它不等於原4vCPU VM／私網，也不代表CPU獨占。
- mio模式、workers/shards1/1與4/4、c50/c500、P32、1M隨機keyspace，每項10Mrequests。每項重啟server並重新10MSET暖機；ABBA/BAAB各cell兩輪配對，seed101/102。詳見規程的固定順序與image／binary identity連結。
- 批次版runtime仍與`66ba3f36d139d2309f0c78590a35396d263ca8db`一致；其後`ef1a6c69abb270549ff422f51f9ad706d3682e7d`新增混合pipeline測試，規程先行提交於`b3802c165f43fc62eb20ba56ef548c612a048c14`。未保留routing實驗，未改預設workers。
- [32項逐輪CSV](benchmark-fixture-20261009.csv)單獨保存本方法。之前1M暖機的順序矩陣及10M暖機的20項診斷仍留在[歷史量測](benchmark-cross-shard.md)，不混成同一平均。

## 兩輪算術平均

吞吐單位Mreq/s，CPU/request單位μs。

| clients／命令 | 原版1w吞吐／CPU | 原版4w吞吐／CPU | 批次版1w吞吐／CPU | 批次版4w吞吐／CPU | 批次版4w/1w吞吐 | 批次版4w/1w CPU |
|---|---|---|---|---|---|---|
| 50／SET | 0.700／1.386 | 0.852／2.986 | 0.740／1.298 | 0.841／2.660 | 1.137× | 2.049× |
| 50／GET | 0.776／1.250 | 0.898／2.920 | 0.785／1.245 | 0.929／2.577 | 1.184× | 2.069× |
| 500／SET | 0.741／1.306 | 1.228／2.454 | 0.728／1.321 | 1.247／2.144 | 1.713× | 1.623× |
| 500／GET | 0.754／1.246 | 1.376／2.374 | 0.747／1.283 | 1.383／2.146 | 1.851× | 1.672× |

四worker前後差異（批次版相對原版，各版均值的比率）：

| clients／命令 | 吞吐變化 | CPU/request變化 | 原版／批次版p99（ms） | p99變化 |
|---|---|---|---|---|
| 50／SET | -1.23% | -10.93% | 3.411／3.807 | +11.61% |
| 50／GET | +3.44% | -11.75% | 3.195／3.319 | +3.88% |
| 500／SET | +1.58% | -12.65% | 28.359／20.143 | -28.97% |
| 500／GET | +0.46% | -9.63% | 26.455／17.559 | -33.63% |

四worker的8對CPU/request都較原版低，但相對單worker仍約1.62–2.07倍；不能把相對原版改善當成「接近單worker」完成。c50SET的兩對吞吐差為正／負，c50p99均值略升；小樣本不足以宣稱稳定因果改善或無傷害。c500通過吞吐比，不會抵消c50失敗。

## 干擾與判讀限制

server affinity CPU 的host steal範圍為0.10–0.64%；client全機host steal為4.51–14.51%。client host busy／steal包含其他程序及全部CPU，不能替代benchmark process的利用率。這是可見的client端干擾，不是其造成低擴展性的證明。

server CPU seconds以process user+system ticks差計算；兩次快照視窗含SSH、client容器啟停及client快照開銷，並非精確負載期間採样。各thread CPU及client netdev counters保存在原始證據；未證明client process飽和、網路線速或沒有TCP重傳。

兩版所有warmup／量測exit0，stderr均為既有CONFIG-fetch警告，server無panic/ERROR、未OOM；cleanup記錄成功。這些檢查不等於獨立逐請求零協定錯誤稽核。每個cell只有兩輪，未估穩健信賴區間，沒有硬體不可達／default-workers替代驗收證明。

## 下一個診斷入口

維持c50 SET、四worker／四shard、P32、四clientthreads、10Mrequests／10M暖機、相同batching binary及server；以ABBA＋BAAB共四對，交錯比較目前與另一個已記錄規格的client位置，並增加對齊的benchmark process／thread負載、host steal、路由／RTT視窗。先寫新規程並核對新client的硬體／路由／image和資源清除，再開始量測。這能檢查client／路徑敏感性；若有差異，也不能直接歸因於CPUsteal。新方法獨立保存，不與本矩陣合併。未取得明確證據前不調低spinbudget、不修改default或放寬驗收。

診斷的預先判準：替代client在四對都提高吞吐至少5%、p99不較差、server CPU/request增加不超過5%，才支持此cell有可重現的client／路徑限制；混合結果未支持預先設定的四對皆提升至少5%的效果，不能排除所有client影響。這不是降低產品1.5倍門檻，也不能直接歸因於steal。
