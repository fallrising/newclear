# Agent Workforce 文件

主設計與不變量在 [SDD](../SDD.md)，目前是設計文件，沒有可啟動的服務。此目錄保存接入差異、真實場景及驗收方法，不保存私人帳號清單、原始對話或執行 trace。

| 文件 | 用途 |
| --- | --- |
| [Quickstart](quickstart.md) | 本輪可閱讀的成果、實作前置與目前阻擋 |
| [Provider capabilities](provider-capabilities.md) | 官方接口、權益與版本證據、待驗證能力 |
| [First scenario](first-scenario.md) | 一張工程工單的 writer／reviewer 合作與中斷恢復 |
| [Verification](verification.md) | 16 項 AC、證據層與故障注入 oracle |
| [Cross-node transport](cross-node-transport.md) | 跨節點設計需求、Yobiru 0.5 概念對照（不採用）與故障矩陣 |

供應商文件會變動，能力表每次更新都要附查核日期；實機 promotion 另保存精確 route 與環境證據。文件變更不能自動將 runtime 狀態升為可用。
