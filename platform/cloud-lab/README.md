# Cloud Lab

單人 Cloudflare 工具與遠端運維的共同入口。原目標是整理既有工具、共用必要介面、接上看板與 bot，並逐步連接運維／agent 平台。

**現在已有可部署的單節點健康檢查閉環，但還不是完整雲 lab。** 2026-11-01 [Opus 5.5方向審查](docs/direction-review.md)判定需要重排：保留已有可靠性，優先回到既有工具整合。

## 現在能做什麼

| 能力 | 已有結果 | 邊界 |
| --- | --- | --- |
| API／定時節點健康檢查 | Worker／D1→non-root runner→驗證結果；15分鐘Cron曾實際通過 | 只有一種load／disk recipe、一個節點；不是任意遠端shell |
| Access看板 | 命令、結果、未知／過期與應用用量；Safari登入／手動用量有owner回報 | 部署存在不代表目前human授權有效 |
| 獨立bot工具 | check／status、MCP與Grok工具接線曾完成真實閉環 | bot窗口已到期；沒有驗證Grok自然語言自主調度 |
| 恢復與備份 | 故障對帳、unknown保留、官方D1隔離還原與三份journal備份通過 | 不宣稱活躍程序切換或跨系統原子快照 |
| 既有CF工具／agent平台整合 | [CF工具目錄](docs/tool-catalog.md)已核對64個可見repo；含Edge Ops重複判定 | 尚未接入第二種能力、遷入／封存既有應用或實作agent平台adapter |

## 使用與授權

[本機啟動](docs/quickstart.md)提供不接真實帳號的demo；已部署環境使用既有私人入口與設定，公開repo不保存憑證或私人網址。[操作紀錄](docs/live-operations.md)及[無桌面OAuth](docs/headless-oauth.md)供接手使用。

截至最後已保存的部署證據：human／bot短窗口已到期，resident政策截止 **2026-11-05T07:24:25Z**。這不是本次新做的live狀態查詢；不能保證現在仍在運行。到期不會刪除Worker、D1或歷史資料，但受限操作不能繼續。沒有自動續權；日常授權方案需明列scope、期限、限額與撤銷方式後批准。

## 接下來只做三件事

1. 整理真實現況、可用入口與日常授權方案；不再用過時pending推動新一輪加固。
2. 依[CF工具盤點](docs/tool-catalog.md)保留原工具責任；node-health維持日常健康入口，Edge Ops先作參考。
3. 下一個接入選既有CF資源盤點報告：沿用原GET-only工具，補有界資料介面與看板；不先造通用plugin平台。

具體停止條件見[方向調整](docs/direction-review.md)。provider用量API、更多授權工具層、Event／seq、active failover與模板生成暫緩；既有安全性質、測試及歷史保留。

## 文件入口

- [知識樹](docs/knowledge-tree.md)／[成功契約](SUCCESS.md)：能力與證據狀態。
- [SDD](SDD.md)／[M1實作契約](docs/m1-implementation.md)／[API](contracts/m1.openapi.json)：設計與現行固定profile。
- [CF工具目錄](docs/tool-catalog.md)／[M0來源](docs/sources.md)／[遷移計畫](docs/migration.md)：當前處置建議、原元件與唯一維護責任。
- [故障證據矩陣](docs/failure-matrix.md)／[還原流程](docs/remote-restore.md)：已有保障與未驗範圍。
- [歷史里程碑](docs/milestone-history.md)／[任務板](docs/tasks/BOARD.md)：歷史結果與Git交付。

維持Workers Free、不新增付費方案；provider實際帳單／用量未知時保持unknown。完整mainline尚未完成，沒有usable tag。
