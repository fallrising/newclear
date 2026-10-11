# Quickstart：先固定工作，再開始實作

**目前狀態：Blocked — implementation not started。** 這是 A 檔設計項目的入口說明；沒有安裝、啟動或部署命令，也沒有可連接的 Workforce endpoint。

## 現在可以完成的事

1. 讀 [SDD](../SDD.md) 的領域、交互圖及里程碑，確認工作者與帳號／資源的關係。
2. 用 [provider matrix](provider-capabilities.md) 選兩條候選原生 route；官方有文件仍要分別驗證實際帳號、版本及工具能力。
3. 讀 [第一場景](first-scenario.md)，選一张小型工程工單作未來試跑，不把整個未完成產品當首個測試。
4. 用 [verification](verification.md) 看通過條件；本次文件 QA 與後續 runtime 證據分開。

## 各里程碑需要固定的輸入

| 輸入 | 目前狀態 | 如何取得 |
| --- | --- | --- |
| 實作範圍與里程碑 | 本次僅 SDD；M1 尚未啟動 | 由 operator 選定下一個明確切片 |
| 語言與本地 controller 儲存 | 首版建議 SQLite，語言未選定 | 在 M1 設計檢查時定案，不先引入服務集群 |
| 真實 route inventory | M2 前；未盤點 | 使用受控配置建立 account aliases／credential refs；不提交秘密；不阻擋 M1 fake 核心 |
| 原生 route 的版本／輸出／resume／拒絕能力 | M2；官方文件已研究，runtime 未驗證 | 先無模型 preflight，再在授權環境做有界 smoke；M1 使用合成 route |
| 外部工單／repo 與 AC | M3 前；尚未選定 | 固定 work_ref、base SHA、scope、檢查及交付授權 |
| Job grant 與預算 | M1 合成契約；真實值待 M2／M3 | 指定允許 worker／route、資源、操作、時限與停止條件 |
| Kith／backend 接線 | M3 可選子切片；僅契約設計 | 獨立驗證兼容性後接入，保留相鄰元件 gates |

新增帳號、設定 DNS／email、登入、調用付費模型與部署都不在閱讀本文件時發生。選好工作與兩條 route 之後，才執行對應里程碑的前置檢查及開發。
