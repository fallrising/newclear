# 可替換測試環境與完整交錯基準規程

本規程先固定方法，再執行量測。主機與執行者可以更換；每次更換建立獨立環境快照與結果集，保留之前的原始資料、方法、binary identity、審查及失敗記錄。新的數據不冒稱重現未確認的舊環境，也不與不同方法的資料合併。

## 本輪替代環境

使用兩台獨立的 AMD EPYC 7443P、6 vCPU VPS：一台 server、一台 client。server 容器使用 CPU affinity 0–3，client 四 threads；Docker host networking，直接 Ethernet，無 VPN。這提供四個 server 可用 CPU，但不等於四 vCPU VM 或獨占 CPU，也不是原基準的私網。執行前保存雙方 CPU、記憶體、kernel、網路路由與負載快照；識別主機的資訊留在私有證據，不寫入公開 CSV。

原版與批次版使用 [既有基準記錄](benchmark-cross-shard.md) 的不可變 release 執行檔及 image digest。最終批次版 source 為 `ef1a6c69abb270549ff422f51f9ad706d3682e7d`；runtime 與 `66ba3f36d139d2309f0c78590a35396d263ca8db` 相同。執行前核對兩個 SHA256，量測期間不並行編譯或 perf 採樣。

## 固定參數與順序

完整矩陣為版本 × workers/shards（1/1、4/4）× clients（50、500）× 命令（SET、GET）× 兩輪，共 32 個量測項目。每項重啟 server，先以 c50、四 threads、P32、1M 隨機 key、seed 0 執行 **10M SET 暖機**；量測同樣使用 10M requests、1M keyspace、四 threads、P32。两輪 seed 101、102，配對兩版使用相同 seed。`RUDIS_IO_URING=0`。

A 是原版、B 是批次版。ABBA 的種子為 101、101、102、102；BAAB 同理。每個 cell 的兩個相鄰版本構成一對，避免完整跑完 A 才跑 B 的時間偏差。workers 的測量順序亦輪替：

| cell | workers/shards | clients | 命令 | 版本順序 |
|---|---|---|---|---|
| 1 | 1/1 | 50 | SET | ABBA |
| 2 | 4/4 | 50 | SET | BAAB |
| 3 | 4/4 | 50 | GET | ABBA |
| 4 | 1/1 | 50 | GET | BAAB |
| 5 | 1/1 | 500 | SET | ABBA |
| 6 | 4/4 | 500 | SET | BAAB |
| 7 | 4/4 | 500 | GET | ABBA |
| 8 | 1/1 | 500 | GET | BAAB |

client 命令參數：

```sh
redis-benchmark -h "$SERVER_IP" -p "$PORT" --threads 4 \
  -c "$CLIENTS" -n 10000000 -r 1000000 -P 32 \
  -t "$COMMAND" --seed "$SEED" --csv
```

暖機使用相同命令，將 clients、command、seed 分別改成 50、set、0。每項都重新暖機，包括 GET。

## 證據與恢復

每項保存 warmup/量測 CSV、stderr、exit status、server log、server process/thread CPU ticks、server affinity CPU 的 host steal 視窗、client host CPU/load/netdev 視窗。server CPU/request = process user+system ticks 差 / CLK_TCK / 10M；p99 取 redis-benchmark CSV。採樣視窗含 SSH/容器啟停與 host 快照開銷，不能當精確負載期間利用率；client host CPU 含其他程序，不能當 client process CPU。

預先保存規程版本、runner digest、環境及 binary 快照。每個 cell 完成後存結果及檔案 SHA256 manifest，再進入下一個 cell。續跑只能跳過方法相同、exit 0、四個有效樣本且所有 digest 相符的已完成 cell。中斷 cell 的資料保留，重跑使用新的 attempt 目錄；不得把缺樣本當成功或覆寫之前失敗。每項／每個 cell 都記錄自身容器和暫時 firewall rule 清除結果，不動其他服務。

CONFIG-fetch 警告是既有命令限制，必須對稱保存。CSV／exit 0 並非獨立逐請求零錯誤稽核。兩輪不足以估計穩健信賴區間；host steal 或 client/network 限制需據實呈現。

## 驗收與後續

每個 clients/命令組分別報告兩版的 workers1/4 吞吐、CPU/request、p99、配對變化與逐輪數據。批次版 workers4/1 吞吐標準維持 ≥1.5；未通過項目不能被其他 cell 的平均掩蓋。每請求 CPU 是否接近單 worker、相對原版是否改善、吞吐／p99 是否受損必須一併評估。

若未過，保留草稿並依結果選擇具體診斷或優化；不能因更換環境宣稱硬體不可達、直接修改預設或放寬門檻。增加重複樣本前先記錄原因、待驗假設與新方法版本；新實驗另存，保留原矩陣。完整性能審查通過前不宣稱驗收完成。
