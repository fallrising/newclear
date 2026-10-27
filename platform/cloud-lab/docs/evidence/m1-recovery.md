# M1 isolated recovery evidence — 2026-10-27

本次[FR-01～04](../recovery-qualification.md)通過：新增真實程序／HTTP回歸與可重跑的實際workerd/D1 binding隔離故障工具。產品runner、Worker及migration內容不變；沒有重啟live服務、讀寫live journal或操作遠端Cloudflare。

## 結果

| 場景 | 故障時證據 | 重啟及對帳 |
| --- | --- | --- |
| started後SIGKILL | marker證明已進入collector邊界；SQLite為started／result null；該子程序由SIGKILL退出 | 自然lease到期後新reconcile_only fence；採集呼叫仍1次、journal原樣保留；回報unknown、控制面reconciling／active1／result null |
| 回報送達前斷線 | SQLite先有completed完整結果；HTTP代理在轉交Worker前切斷；子程序exit1，控制面dispatching | 新reconcile_only fence原樣補報artifact及原始開始／完成時間；validated result_recorded／active0；journal未改、採集1次 |
| Worker保存後ACK遺失 | Worker report回200並已保存terminal狀態，代理隨後切斷socket；子程序exit1 | 新程序claim為空；控制面整列及journal不變；沒有新report、採集仍1次 |

對帳另核對immutable identity digest、external_ref、artifact完整字串及SHA-256、時間，並確認同payload重送同command ID。前兩個需換fence的案例（started／送達前遺失）均拒絕舊fence且不改控制列。unknown案例最後執行，新命令因容量占用被拒絕；最終隔離DB為3commands／active1，沒有清空unknown來製造全綠。

## 實際執行

- fixture建立前，三項新增測試因missing fixture／未達collector barrier而RED；這是測試工具尚未實作，不宣稱產品存在恢復缺陷。
- 共用launcher執行 `python3 platform/cloud-lab/tools/check.py`：31 Node＋70 Python＝101 tests通過，完整輸出保存在FR-green-barrier的保護證據目錄。
- 共用launcher執行 `timeout --signal=TERM --kill-after=10s 180s node platform/cloud-lab/tools/qualify_recovery.mjs <existing-toolchain>`：exit0，before／after／started三場景通過。Miniflare `5.20261023.0-beta`，沿用先前工具鏈，沒有新安裝。每個子程序另有10秒上限，snapshot查詢5秒上限。
- FR-workerd-closed的保護證據包含summary（含來源hash）、各案例fault／recovered snapshot、子程序退出證據、collector marker、原journal及隔離D1持久狀態。工具未直接改lease／命令deadline，也沒有mock Worker或D1 binding。

本機測試的HTTP控制面是fixture；只有可選workerd工具執行真正Worker及binding。身份synthetic，collector呼叫既有固定OS採集，但started案例在該邊界暫停，無任意shell或新runtime故障開關。這不證明任意副作用能exactly-once，也不證明遠端CF、systemd自動重啟或整台主機斷電恢復。

[T-821獨立審查](../../../../.team/reports/T-821.md)及一次focused follow-up均ACCEPT；主導另將CI的SIGKILL barrier收緊為等待完整marker，檢查小幅diff並再跑101tests通過。Git交付依正常PR／CI／merge／readback。完整AC-06～08保持pending，mainline=incomplete，usable_tag=none。

工具自查修正：空marker不再算1次採集，僅完整collect行可計數。初輪101tests通過但出現SQLite ResourceWarning，已明確關閉測試／fixture snapshot連線；修改後重新跑完整suite與三個workerd案例，保留先前紀錄。這是驗證工具修正，產品runtime不變。
