# Pixelorama lab 的工作入口

先讀 [SUCCESS.md](SUCCESS.md)、[SDD.md](SDD.md)、[最近驗收](docs/acceptance.md) 與 [任務板](docs/tasks/BOARD.md)，再核對根 [AGENTS.md](../../AGENTS.md) 的現行規則。

- 工作引用為 issue #834／本 lab 的 T-0834；認領與每次 push 的時間記在任務板。
- 本次交付是 SDD 基線；runtime AC 均未驗。實作前更新本次範圍、AC 與測試計畫，不能把文件檢查改稱素材或瀏覽器測試。
- 必須保留可由 Pixelorama 開啟的原生 `.pxo`，並以真 Pixelorama 匯出驗證。普通 PNG、程式生成占位圖或手寫 manifest 不能單獨滿足此要求。
- 上游軟體不 vendoring；binary、暫存、私人路徑與憑證不進 Git。素材來源、授權與 SHA-256 獨立記錄。
- 公開 repo 僅記本 lab 所需的公開需求，不複製私人 KB、其他 repo 的私人內容或環境資訊。
- 成功條件、剩餘缺口及證據回寫 SUCCESS；未完成核心流程前維持 `mainline: incomplete`、`usable_tag: none`。本輪只建立 Draft PR，不 merge、release 或 deploy。
