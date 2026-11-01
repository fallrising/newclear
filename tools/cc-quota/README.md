# cc-quota（已封存）

> **Portfolio doc tier: D (retired / historical)** — Owner 於 2026-10-23 指示封存。
> [SUCCESS.md](SUCCESS.md) 保留歷史驗收與未完成項；封存不代表驗收通過。

後續開發與使用入口統一到 [Agent Usage](../codex-usage/docs/agent-usage.md)。
本項目停止獨立開發，原地保留來源、測試、歷史文件與舊指令路徑，供相容性與追溯使用。
不移動或刪除 SQLite、憑證、設定，不自動卸載／重裝已安裝的 launchd 或通知工作。

Agent Usage 可唯讀使用既有 cc-quota DB；不呼叫此封存採集器、不繼承其未公開接口或憑證讀取行為。
既有排程／通知仍屬封存版本，沒有宣稱已遷移成新的受維護功能。
真 Claude usage／Keychain、launchd、通知及睡眠恢復的原未驗項仍保留；重新啟動本項目需 owner 新指示。

- [歷史功能與限制](docs/legacy-overview.md)
- [歷史操作文件](docs/quickstart.md)
- [歷史任務與證據](docs/tasks/BOARD.md)
- [封存與後繼工具報告](../codex-usage/docs/evidence/2026-10-23-history-report.md)

相容性測試保留，不代表恢復開發或推薦新安裝。[文件政策](../../docs/portfolio-doc-tiers.md)、[Portfolio](../../PORTFOLIO.md)。
