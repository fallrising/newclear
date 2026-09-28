# SDD 閱讀順序

先讀 [總綱](../../SDD.md)，再依下列順序完整閱讀。本文集為 v0.1 設計；實作進度僅見 [STATUS](../STATUS.md)。

| 文件 | 解決的問題 |
| --- | --- |
| [01 前端](01-frontend.md) | 使用者流程、頁面、狀態、權限與 UI 驗收 |
| [02 後端](02-backend.md) | Cloudflare 分工、資料模型、原子性、故障與告警 |
| [03 Agent](03-agent.md) | 指標／log 採集、程序與權限、spool、執行生命週期 |
| [04 Bootstrap 與 image](04-bootstrap-and-images.md) | Terraform、cloud-init、Packer、雲商 Agent 的分工及初始化設計 |
| [05 共用契約與安全](05-contracts-and-security.md) | API、身分、approval、狀態機、版本與攻擊面 |
| [06 交付與驗收](06-delivery-and-acceptance.md) | 三線平行、依賴、驗收案例與授權閘門 |
| [07 容量與維運](07-capacity-and-operations.md) | 免費額度推演、保留期、觀測自身、备份與還原 |

官方依據、固定 repository 證據與不確定性集中於 [SOURCES](../SOURCES.md)。範例 ID、時間與數值皆為合成資料或明示的設計假設。
