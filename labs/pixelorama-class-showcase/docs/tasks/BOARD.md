# Pixelorama lab 任務板

## T-0834 — 四職業能力展示

需求與認領：[issue #834](https://github.com/fallrising/newclear/issues/834)。承接者 ChatGPT-GPT-6-Astra-Pro-pilot；來源為 owner 直接交辦。規格見 [SDD](../../SDD.md)，產品驗收見 [SUCCESS](../../SUCCESS.md)。

本輪範圍僅 SDD 與 lab 文件基線；不宣稱 P0 已完成。[PR #836](https://github.com/fallrising/newclear/pull/836) 已合併，文件列 D1 結案；runtime 列尚未開工，沒有開始時間。後續唯一下一步是魔法師真 `.pxo` → 匯出 → 最小網頁閉環，不先擴張 MMORPG；該實作不在本次合併／結案授權範圍內。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0834-D1 | SDD、SUCCESS、素材契約、任務板與索引；文件里程碑合併及回讀 | AC-01–07 規格 | done | 2026-10-30T16:34:17Z | 2026-10-31T03:17:48Z | 2026-10-31T03:52:04Z |
| T-0834-A1 | 固定工具與四職業原生素材；先完成魔法師 | AC-01 | todo | — | — | — |
| T-0834-A2 | adapter 與角色頁接線，真產物載入 | AC-02 | todo | — | — | — |
| T-0834-A3 | 純函數、資料檢查、能力 UI 與比較 | AC-03 | todo | — | — | — |
| T-0834-A4 | 動畫狀態、切換、暫停與減少動態 | AC-04 | todo | — | — | — |
| T-0834-A5 | 手機／桌面、鍵盤、跨瀏覽器與視覺審查 | AC-05 | todo | — | — | — |
| T-0834-A6 | 重複匯出與修改原稿後頁面回讀 | AC-06 | todo | — | — | — |
| T-0834-A7 | 乾淨 checkout、build、來源與獨立 review | AC-07 | todo | — | — | — |

## 文件里程碑合併收據

- Owner 於 2026-10-31 明確授權合併與必要文件結案，取代本次範圍內的 Draft-only／等待批准停止點；沒有授權 Demo 實作、release、usable tag 或部署。續接紀錄保留在 issue #834。
- 原 PR #836：`merged=true`；合併時間 `2026-10-31T03:17:48Z`；真正 merge commit 為 `8d74c1ae64cfea11d5729e1a0b89acee12728991`。D1 的 end 使用該時間，不使用收尾 PR 時間。
- 本次重新查詢 [PR 候選的 Project success contracts](https://github.com/fallrising/newclear/actions/runs/41093728859) 與 [合併 commit 的 main 檢查](https://github.com/fallrising/newclear/actions/runs/41163753984)，均為 success；已回讀 main 指向上述 merge commit，並核對 SDD／SUCCESS。沒有 review 提交或未處理 thread；不冒稱已取得獨立 reviewer 的批准。
- 歷史文件檢查及未執行項仍見 [acceptance](../acceptance.md)。本次僅結案 D1；SUCCESS 保持 `mainline: incomplete`、`usable_tag: none`，AC-01–07 全為 pending。產品測試、Pixelorama 原生素材／匯出、瀏覽器與視覺驗收均未執行，A1–A7 不標 done。
