# Handwired 技術任務板

## T-0465 — HW-2 係數學習

來源：owner 直接續作指示；Refs #465。Session Handwired-20261022-0411。規格：[SDD](../SDD.md) §5、§8；主線 AC-03。HW-3 不在本次範圍。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0465-03 | 真實上游梯度對照解析式 | HW-A03 / AC-03 | done | 2026-10-22T04:12:20Z | 2026-10-22T04:42:13Z | 2026-10-22T04:42:31Z |
| T-0465-04 | 固定九點、500 步收斂與同頁操作 | HW-A04 / AC-03 | done | 2026-10-22T04:12:20Z | 2026-10-22T04:42:13Z | 2026-10-22T04:42:31Z |
| T-0465-05 | 學習率 2.0 發散停止與重設 | HW-A05 / AC-03 | done | 2026-10-22T04:12:20Z | 2026-10-22T04:42:13Z | 2026-10-22T04:42:31Z |

已於 2026-10-22T04:42:13Z 合併 [PR #466](https://github.com/fallrising/newclear/pull/466)，merge commit `c81d92d72cfda9a3a9dba87a15e62791a85ff1e6`。最終 head `d46a263818b199d87f786a38ed81da4e6e6a2514` 的本機驗證、CI 與不同模型家族審查見 [合併前驗收紀錄](https://github.com/fallrising/newclear/pull/466#issuecomment-6332886059)；19 項測試、41 項主線契約與實際 Chromium 操作通過。此板僅結案 HW-2 / AC-03；HW-3 / AC-04 仍待真人試用，主線未完成，沒有 usable tag 或部署。
