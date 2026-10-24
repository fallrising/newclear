# FE Review Prompt — ClarkQ

目前為已批准 DESIGN M1–M3 的 R2候選收尾；實作及實際證據見[報告](tasks/round2/report.md)。完整 R3另行進行。遵循[共用規範](../../../docs/fe-review/PROTOCOL.md)、[DESIGN](DESIGN.md)與[RUNNER](RUNNER.md)。

只用本次專有 network-none/nonroot環境、loopback Go binary、全新空白 state/key；不得執行既有 demo Compose、讀取既有 config/CLI憑證、放寬 auth 或操作真 queues。HTML嵌入 binary；更改後須重建再驗證。

原 R2已實測：三個深色viewport1440×900／834×1112／390×844、合法64字queue/中文長body/14queues、真Save/Refresh/enqueue/Use/Peek/Consume/Clear取消與確認、missing/invalid key、empty、非法名、受控網路失敗與恢復、五秒刷新焦點與depth。實際鍵盤使用Tab及Enter；baseline的programmatic focus僅是原問題觀察，不能替代鍵盤旅程。

共用capture使用私有ephemeral targets/storageState，dry-run及actual皆有證據；不使用假start。不要公開DOM/localStorage/header/trace/key或PNG。保留全部歷史失敗，不把favicon404分類當作已修或health全零；其餘未知事件仍失敗。

原單機可用資格、dormant狀態、後端／queue語意與部署範圍不變。新功能、主題、cluster或production不在此範圍。
