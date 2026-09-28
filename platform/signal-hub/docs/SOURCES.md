# Signal Hub — 來源

所有外部來源於 2026-09-28 存取。`prometheus.io`、`docs.victoriametrics.com`、`docs.ntfy.sh` 等官方網站被本次工作環境的網路 proxy 擋住，所以改讀各專案官方 GitHub repository 中的同一份文件。版本與行為在實作時需要重新確認。

| ID | 來源 | 查核的事實 | 用在哪裡 |
| --- | --- | --- | --- |
| S01 | [CloudEvents specification](https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md) | 必填 `id`、`source`、`specversion`、`type`；`source + id` 由 producer 保證唯一；attribute 名稱只能用小寫字母與數字，建議不超過 20 字元，不能叫 `data` | 01 事件信封、extension 命名、去重鍵 |
| S02 | [Alertmanager configuration — webhook_config](https://github.com/prometheus/alertmanager/blob/main/docs/configuration.md)、[README](https://github.com/prometheus/alertmanager/blob/main/README.md) | webhook payload `version: "4"`，含 `groupKey`、`status`、`alerts[]`；每個 alert 有 `status`、`labels`、`annotations`、`startsAt`、`endsAt`、`generatorURL`、`fingerprint`；Alertmanager 提供 grouping、inhibition、silencing | 01 Alertmanager adapter；ADR-07 |
| S03 | [VictoriaLogs LogsQL](https://github.com/VictoriaMetrics/VictoriaLogs/blob/master/docs/victorialogs/logsql.md) | `stats` pipe 可依時間桶分組，例如 `stats by (_time:1h) count()`；有 `count_uniq` 等函數 | 03 規則格式可翻譯性；ADR-03 |
| S04 | [VictoriaLogs vmalert](https://github.com/VictoriaMetrics/VictoriaLogs/blob/master/docs/victorialogs/vmalert.md) | vmalert 可用 VictoriaLogs 作資料源，以 LogsQL 寫 alerting／recording rules（group 設 `type: vlogs`），結果寫到 remote-write 儲存 | 日後投影路徑；ADR-03 |
| S05 | [CloudEvents HTTP protocol binding](https://github.com/cloudevents/spec/blob/main/cloudevents/bindings/http-protocol-binding.md) | 結構化模式 `Content-Type: application/cloudevents+json`；批次模式 `application/cloudevents-batch+json` | 01 ingest API；04 webhook body |
| S06 | [ntfy publish docs](https://github.com/binwiederhier/ntfy/blob/main/docs/publish.md)、[README](https://github.com/binwiederhier/ntfy/blob/main/README.md) | HTTP PUT／POST 發布到 topic；`X-Title`、`X-Priority`（1–5）、`X-Tags`、`X-Click` 標頭；可自架；Apache-2.0／GPLv2 | 04 ntfy 對映 |

## 內部依據

- knowledge-base `44.05` 筆記：產品邊界、相近專案盤點、owner 決定（個人用途、每天 ≤ 1000 筆、封存、入口分開、不自動執行）。
- `kernel/infra/specs/docs/products/nats-push-bridge/`：stable delivery ID、HMAC 簽章、DLQ 與重放規則；本 SDD 的 04 沿用其契約形狀。
- `platform/edge-ops`：文件結構與「SDD 不等於實作、STATUS 為唯一進度權威」的約定。

## 未查核

- Apache ECharts 的授權與 bundle 大小：M3 前確認。
- SQLite WAL 與 online backup 的官方文件：sqlite.org 本次未存取；M1／M5 實作前確認。
