# 效能量測紀錄

[回 v2 索引](README.md) ・ 門檻：[02 §5.4](02-backend-sdd.md#54-效能目標本機postgresql-16單類型-10000-筆) ・ 量測腳本與未達標處理：[waves/BW4.md §5.4](waves/BW4.md#54-效能量測與紀錄t08)

本檔只記數字，量測方法見 [BW1b §5.6](waves/BW1b.md#56-效能量測方法t11)。每次量測加一列到表格末尾，不修改舊列。「預演」列是細化施工圖時在副本上量的，不算實作驗收；BW4 實作時加的三列才是 02 §7「§5.4 全部達標並記錄數字」的依據。

門檻（p95）：工作列表 ≤ 150 ms、公開列表 ≤ 100 ms、單筆 PATCH ≤ 80 ms；列表 SQL 數 ≤ 5 且與筆數無關。

| 日期 | 量測者 | 環境 | 工作列表 p95 | 公開列表 p95 | PATCH p95 | 列表 SQL 數 | 結果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-09-25 | BW1b 細化預演 | Linux 容器、PostgreSQL 16、JDK 21 | 43 ms | 40 ms | 8 ms | 4 | 達標 |
| 2026-09-25 | BW4 細化預演（第 1 次） | Linux 容器、4 核、PostgreSQL 16.13、JDK 21 | 41 ms | 41 ms | 8 ms | 4 | 達標 |
| 2026-09-25 | BW4 細化預演（第 2 次） | 同上 | 41 ms | 38 ms | 8 ms | 4 | 達標 |
| 2026-09-25 | BW4 細化預演（第 3 次） | 同上 | 43 ms | 42 ms | 9 ms | 4 | 達標 |

| 2026-10-04 | BW4 實作（第 1 次） | Linux、4 核、PostgreSQL 16.15、JDK 25.0.4.1 | 74 ms | 71 ms | 18 ms | 4（內容查詢） | 達標 |
| 2026-10-04 | BW4 實作（第 2 次） | Linux、4 核、PostgreSQL 16.15、JDK 25.0.4.1 | 70 ms | 75 ms | 17 ms | 4（內容查詢） | 達標 |
| 2026-10-04 | BW4 實作（第 3 次） | Linux、4 核、PostgreSQL 16.15、JDK 25.0.4.1 | 74 ms | 77 ms | 19 ms | 4（內容查詢） | 達標 |

BW4實作三次皆強制重跑原本10,000筆測試，門檻不變。[原始數字與指令](../../.team/evidence/bw4-performance.json)由[量測腳本](../../.team/evidence/bw4-perf-run.py)保留。queryEntries每次實測2句SQL；列表內容store呼叫另有findTypeByKey/fieldsOf，合計4句，且不隨頁面筆數增加，由ListQueryCountTests固定。這裡沿BW1b量測內容查詢，不把store層時間當成HTTP端到端延遲。
