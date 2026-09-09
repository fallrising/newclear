# 08 — 節點 Agent 與採集器契約

## 1. 設計立場

`prism-agent` 是**預設但可替換**的採集器。平台的採集契約是「能送 OTLP / remote_write / Loki push 即可」，因此 Vector、Fluent Bit、OpenTelemetry Collector、node_exporter + Prometheus agent mode 都是合法採集器。

`prism-agent` 存在的理由只有兩個：
1. 單一 binary、單一設定檔就能覆蓋 90% 的 VPS 場景（主機指標 + 檔案日誌 + journald + 容器日誌）。
2. 提供第三方採集器沒有的**遠端配置下發**與**納管視圖**。

**明確的非目標**：不追求取代 Vector 的資料轉換能力，不做 eBPF，不做自動插樁。使用者要複雜處理就用 Vector 串在中間。

## 2. 模組

```
cmd/prism-agent/
internal/agent/
├── config/          # 本地 YAML + 遠端配置合併
├── input/
│   ├── hostmetrics/ # gopsutil：cpu/mem/disk/net/load/filesystem/process
│   ├── filelog/     # tail + inode 追蹤 + 多行合併
│   ├── journald/    # sd-journal（cgo）或讀 /var/log/journal（純 Go）
│   ├── docker/      # Docker socket 容器日誌與容器指標
│   └── self/        # agent 自身指標
├── process/         # 標籤注入、多行合併、取樣、遮罩
├── wal/             # ★ 本地持久化緩衝
├── output/          # OTLP gRPC exporter
└── control/         # 註冊、心跳、配置拉取、自我升級
```

## 3. 採集內容

### 3.1 主機指標（預設 15s）

指標名稱**必須與 `node_exporter` 一致**，讓官方儀表板（Grafana 1860）直接可用：

`node_cpu_seconds_total`、`node_memory_MemTotal_bytes`、`node_memory_MemAvailable_bytes`、`node_filesystem_size_bytes`、`node_filesystem_avail_bytes`、`node_disk_read_bytes_total`、`node_disk_written_bytes_total`、`node_network_receive_bytes_total`、`node_network_transmit_bytes_total`、`node_load1/5/15`、`node_uptime_seconds`、`node_boot_time_seconds`、`node_context_switches_total`、`node_procs_running`、`node_procs_blocked`、`node_filefd_allocated`

若某指標無法在該平台取得，**不上報**（不要填 0，0 是有意義的值）。

進程指標（`agent.process.enabled`，預設 false，因為基數高）：
`process_cpu_seconds_total`、`process_resident_memory_bytes`、`process_open_fds`，標籤 `{comm, user}`，只上報 top N（預設 20，依 CPU 排序）。

### 3.2 檔案日誌

```yaml
inputs:
  filelog:
    - name: nginx
      paths: ["/var/log/nginx/*.log"]
      exclude: ["/var/log/nginx/*.gz"]
      labels: {service: nginx, log_type: access}
      multiline:
        start_pattern: '^\d{4}-\d{2}-\d{2}'   # 不符合者併入上一行
        max_lines: 500
        timeout: 3s
      encoding: utf-8
      max_line_bytes: 262144
```

實作要求：

- **offset 持久化**：`{inode, device, offset}` 存於 `agent.state_dir/positions.json`，每 `flush_interval`（預設 5s）與正常退出時寫入（先寫暫存檔再 rename，保證原子性）。
- **輪替偵測**：inode 變化 → 舊 fd 讀到 EOF 後關閉，新檔從 0 開始；檔案被截斷（size < offset）→ 從 0 重讀。
- **glob 重掃**：每 `discovery_interval`（預設 10s）重新展開 glob，發現新檔案。
- **孤兒 fd 回收**：檔案被刪除但 fd 仍開啟時，讀完剩餘內容後在 `delete_grace`（預設 30s）後關閉，避免佔用磁碟空間。
- **多行合併**：以「新行首符合 `start_pattern` 則開新記錄」的模式（比「續行符合 pattern」更穩健）。超過 `max_lines` 或 `timeout` 強制切斷。
- 檔名與路徑注入為 `Attrs["log.file.path"]`，**不進 Labels**（路徑基數高）。

### 3.3 journald 與容器

- journald：從 `__CURSOR` 續讀，cursor 持久化。映射 `PRIORITY` → `Severity`，`_SYSTEMD_UNIT` → `Labels["unit"]`。
- Docker：`/var/run/docker.sock` 的 `logs?follow=true&since=<ts>`，容器 label 選擇性映射為 Labels（allowlist，預設只取 `com.docker.compose.service`）。

## 4. 處理

- **標籤注入**：`host`、`cluster`、`env` 由 agent 設定注入；`service` 由 input 設定或容器 label 決定。
- **敏感資料遮罩**：`process.redact` 規則列表，正則 → 替換字串。預設內建常見樣式（信用卡號、`password=`、`Authorization: Bearer`、私鑰 PEM 區塊）。**遮罩在 agent 端做，不能等到服務端**。
- **取樣**：`process.sample` 對指定 Labels 的日誌按比例取樣（預設不啟用）。取樣後在 `Attrs["prism.sample_rate"]` 記錄比例。

## 5. WAL（可靠性核心）

這是 `prism-agent` 與玩具的分界線。

```
agent.state_dir/wal/
├── 00000001.seg   # 每段預設 8 MiB
├── 00000002.seg
└── meta.json      # {"read_seg":1,"read_off":4096,"write_seg":2}
```

- **格式**：每筆記錄 = `[uint32 length][uint32 crc32c][protobuf OTLP request]`。段檔寫滿即輪替。
- **寫入路徑**：input → process → **先寫 WAL** → 回覆 input → 另一個 goroutine 從 WAL 讀取並送出。
- **fsync 策略**：`wal.sync_policy` = `interval`（預設，每 1s）/ `always` / `never`。預設在效能與可靠性間取平衡；崩潰可能丟失最後 1 秒。
- **容量**：`wal.max_bytes`（預設 512 MiB）與 `wal.max_age`（預設 4h）。任一超出時**丟棄最舊的段**，遞增 `prism_agent_wal_dropped_bytes_total` 並記錄 WARN。
- **磁碟保護**：state_dir 所在檔案系統可用空間 < `wal.min_free_bytes`（預設 1 GiB）時停止寫入 WAL，改為直接丟棄新資料。**Agent 絕不能撐爆被監控主機的磁碟。**
- **送出確認後**才推進 `read_off`；整段讀完才刪除段檔。
- 啟動時：校驗 CRC，遇到損壞記錄則跳到下一個段開頭並記錄 WARN（不阻止啟動）。

## 6. 輸出

- OTLP/gRPC 到 `agent.output.endpoint`，gzip 壓縮。
- 認證：`Authorization: Bearer <api_key>`（從檔案讀）或 mTLS 客戶端憑證。
- 批次：達 `output.batch_size`（預設 1000 筆）或 `output.batch_timeout`（預設 1s）送出。
- 重試：收到 `RESOURCE_EXHAUSTED` / `UNAVAILABLE` / `DEADLINE_EXCEEDED` → 指數退避（1s 起，上限 60s，含 jitter），**WAL 中的資料不推進**。
- 收到 `INVALID_ARGUMENT` / `PERMISSION_DENIED` → 丟棄該批次（重試無用），記錄 ERROR 並遞增 `prism_agent_export_rejected_total`。

## 7. 自我限制

Agent 必須有硬性資源上限，且預設保守：

| 項目 | 預設 | 機制 |
|---|---|---|
| 記憶體 | 256 MiB | `GOMEMLIMIT` + systemd `MemoryMax` |
| CPU | 20% of 1 core | systemd `CPUQuota=20%` |
| 磁碟（WAL） | 512 MiB | 見 §5 |
| 開啟檔案數 | 1024 | systemd `LimitNOFILE` |
| goroutine | 監控並在超過 10_000 時告警 | 自身指標 |

`deploy/systemd/prism-agent.service` 必須包含這些設定，並附 `NoNewPrivileges=yes`、`ProtectSystem=strict`、`ReadWritePaths=<state_dir>`、`PrivateTmp=yes`。

## 8. 控制通道

RESTful，走與資料相同的 endpoint（不同路徑），避免多開埠：

| 方法 | 路徑 | 說明 |
|---|---|---|
| POST | `/api/console/v1/agents/register` | 首次啟動註冊，回 `agent_id`（持久化到 state_dir） |
| POST | `/api/console/v1/agents/{id}/heartbeat` | 每 `control.heartbeat_interval`（預設 30s），帶版本、OS、狀態、自身指標摘要 |
| GET | `/api/console/v1/agents/{id}/config` | 帶 `If-None-Match: <etag>`；無變更回 `304` |

- 遠端配置與本地配置的合併規則：本地 `agent.config_mode` = `local`（忽略遠端）/ `remote`（遠端優先）/ `merge`（預設，遠端只能改 inputs 與 process，不能改 output/wal/limits）。
- **`merge` 模式的安全理由**：控制平面被入侵時，攻擊者不能把 agent 的資料導向外部端點。
- 配置變更後熱重載 inputs，**不重啟行程、不清空 WAL**。
- 配置校驗失敗 → 保留舊配置，回報錯誤到心跳，觸發告警。

## 9. 第三方採集器契約

`docs/collectors/` 必須提供這些現成設定，並在 CI 中實測：

| 採集器 | 檔案 | 覆蓋 |
|---|---|---|
| OpenTelemetry Collector | `otelcol-config.yaml` | 三種訊號，OTLP exporter |
| Vector | `vector.toml` | 日誌 → Loki sink；主機指標 → prometheus_remote_write sink |
| Fluent Bit | `fluent-bit.conf` | 日誌 → OpenTelemetry output |
| Prometheus (agent mode) | `prometheus-agent.yml` | scrape + remote_write |
| node_exporter | 說明文件 | 配合上一項 |

**這些設定檔的存在本身就是架構主張**：Prism 不綁定採集器，就像不綁定存儲。

## 10. 驗收標準

- G1：`prism-agent` 在乾淨的 Debian 12 VPS 上，安裝後 60 秒內主機指標出現在 Grafana 1860 儀表板且主要面板有資料。
- G2：`prismd` 停機 10 分鐘後恢復，該期間的日誌與指標完整回補（逐筆比對，允許順序不同）。
- G3：`logrotate` 輪替 nginx 日誌，無資料遺失、無重複。
- G4：kill -9 agent 後重啟，WAL 回放正確，最多遺失 1 秒資料（`sync_policy: interval`）。
- G5：state_dir 磁碟填滿至剩餘 < 1 GiB，agent 停止寫 WAL 而非撐爆磁碟。
- G6：持續灌入 50 MB/s 日誌，agent RSS 穩定在 256 MiB 內。
- G7：`vector.toml` 與 `otelcol-config.yaml` 在 CI 中實際跑通並驗證資料落地。
