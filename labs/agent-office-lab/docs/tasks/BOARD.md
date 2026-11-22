# Agent Office Lab 任務板

本次依 owner 直接指示匯入 GitHub；無 desk 卡。AC 沿用 SDD，公開版將 A01–A11 正規化為 AC-01–AC-11。

## T-0001：公開匯入

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0001-01 | 匯入可重建來源、公開證據摘要、任務及索引，完成 PR／CI／回讀 | AC-12 | done | 2026-10-31T11:19:24Z | 2026-10-31T11:23:55Z | 2026-10-31T11:24:23Z |

## T-0002：後續 MVP（持續追蹤）

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0002-01 | CLI capability／版本／缺失偵測 | AC-01 | todo | — | — | — |
| T-0002-02 | 已有 OpenCode 合成任務；移植後補完整 runtime 回歸 | AC-02 | todo | — | — | — |
| T-0002-03 | 官方 Grok／grok-4.6 顯式遠端任務通過 | AC-03 | done | 2026-11-01T04:50:31Z | 2026-11-01T11:02:40Z | 2026-11-01T11:03:20Z |
| T-0002-04 | Pi + DeepSeek 顯式遠端任務 | AC-04 | done | 2026-10-31T18:03:31Z | 2026-10-31T18:19:17Z | 2026-10-31T18:19:51Z |
| T-0002-05 | 原生權限等待、終端回覆及繼續 | AC-05 | todo | — | — | — |
| T-0002-06 | 補 Grok／Pi 取消與所屬程序清理 | AC-06 | todo | — | — | — |
| T-0002-07 | crash、401／429、有界重試與失敗狀態 | AC-07 | todo | — | — | — |
| T-0002-08 | 真正 session resume、刷新及 host 重啟 | AC-08 | todo | — | — | — |
| T-0002-09 | 三工位入口、產物與模型來源辨識 | AC-09 | todo | — | — | — |
| T-0002-11 | 路徑／symlink、hook 偽造及金鑰遮蔽測試 | AC-11 | todo | — | — | — |

## T-0003：獨立研究

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0003-01 | 本地模型完成公開 GitHub tool loop（非 MVP 阻塞） | AC-10 | todo | — | — | — |

匯入交付：[PR #841](https://github.com/fallrising/newclear/pull/841) 已合併，
`02f9139219c502763359ff95b9f2b5d5152e8c77`，四項 CI checks 全部 success（元件離線、project contracts、llms、workflow lint）。
已回讀主線 README 與 merge tree；tree `7862a2a246cd3e0074940ba71d6c9f3d0dda311a` 與本機驗證內容一致。
此結案只完成 AC-12 匯入；主線仍 incomplete，後續 MVP 任務保留 todo，沒有 release／deploy。

## T-0004：OpenCode 生命週期子集

Owner 指示「試試下一步」。本輪不擴大為 Grok／Pi 或完整 host restart 驗收。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0004-01 | 真實權限等待、合成測試的 Allow once PTY 回覆與繼續 | AC-05（OpenCode） | done | 2026-10-31T12:03:32Z | 2026-10-31T12:20:19Z | 2026-10-31T12:20:55Z |
| T-0004-02 | 真瀏覽器刷新不重跑，終止程序後明確恢復同一 session | AC-08（OpenCode 子集） | done | 2026-10-31T12:03:32Z | 2026-10-31T12:20:19Z | 2026-10-31T12:20:55Z |

Owner 已同意先停止舊 demo、完成真實生命週期驗收後重新開啟；T-0004 繼續執行。

T-0004 真實驗收與 15 項離線測試通過，詳見 [生命週期證據](../evidence/lifecycle.md)。[PR #847](https://github.com/fallrising/newclear/pull/847) 已合併並回讀主線 evidence；不將 OpenCode 子集當成完整 AC-05／AC-08。

T-0004 合併 commit：`37ec57999d547ce6b40819ae3758573a7f4d328f`。元件 offline、project contracts 與 workflow lint 三項 CI success。
主線的生命週期摘要已回讀：completed、permission_wait_verified=true、resume_verified=true；原 runtime source hash 與受測 bytes 一致。

## T-0005：Office host 中斷與手動恢復

Owner 指示繼續開發；沿用停止現有合成 demo、驗收後重新開啟的安排。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0005-01 | 持久 interrupted、停止舊 PTY、防止自動喚醒與明確恢復 | AC-08（OpenCode host） | done | 2026-10-31T12:29:42Z | 2026-10-31T12:52:39Z | 2026-10-31T12:52:59Z |
| T-0005-02 | 真實 host crash／重啟、瀏覽器狀態與同 session 恢復驗收 | AC-08（OpenCode host） | done | 2026-10-31T12:29:42Z | 2026-10-31T12:52:39Z | 2026-10-31T12:52:59Z |

T-0005 的四個 host 真實恢復驗收、既有生命週期回歸及 26 項離線測試通過，詳見[重啟證據](../evidence/restart.md)。[PR #852](https://github.com/fallrising/newclear/pull/852) 已合併，commit `843eaf97e77962df75d0b8f7618b01945e2d2b3e`。元件 offline 與 project contracts validate 兩項 CI 全部 success；已回讀主線摘要，host recovery 與 lifecycle regression 均為 completed，manual_resume_verified=true。完整 AC-08 與三 provider MVP 仍待驗收，沒有 release／deploy／usable tag。

## T-0006：遠端 CLI 接入前置

Owner 指示繼續，並提供需要其執行的命令；本輪不發出付費模型請求。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0006-01 | 固定官方 Grok／Pi，實測版本、身分與必要能力，缺失時拒絕 | AC-01（接入前置） | done | 2026-10-31T17:47:08Z | 2026-10-31T17:53:36Z | 2026-10-31T17:54:03Z |
| T-0006-02 | 隔離登入設定與無秘密診斷，提供 owner 可執行命令 | AC-01（接入前置） | done | 2026-10-31T17:47:08Z | 2026-10-31T17:53:36Z | 2026-10-31T17:54:03Z |

T-0006 真實 Grok／Pi help/version 與 Pi 隔離設定格式檢查通過，全程 OS 阻擋網路；35 項離線測試通過。遠端任務等 owner 登入／設定，見[命令與範圍](../REMOTE-SETUP.md)。[PR #856](https://github.com/fallrising/newclear/pull/856) 已合併，commit `5c5afa06aec8a40df86c89f0a9913772772d77b1`。offline／validate 兩項 CI success；回讀主線證據，Pi 1.4.0 與官方 Grok 1.0.70 compatible=true、remote_requests_sent=false。這是 CLI 前置結案，AC-01 整體、AC-03／AC-04 與三 provider MVP 仍 pending；等待 owner 設定後才繼續遠端任務。

## T-0007：Pi + DeepSeek 原生工位驗收

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0007-01 | 有界 Pi runner、原生啟動與 owner 授權的一次付費任務通過 | AC-04 | done | 2026-10-31T18:03:31Z | 2026-10-31T18:19:17Z | 2026-10-31T18:19:51Z |

T-0007：owner 已確認一次付費驗收；3 次 DeepSeek 請求、原生 agent_settled、產物及清理通過。[真實證據](../evidence/pi-live-2026-11-01.json)。此次授權已用完，未追加重跑；[PR #861](https://github.com/fallrising/newclear/pull/861) 已合併，commit `55c0c6d68c055aab6613ce6293a4d8ba7b8e2f39`。offline／validate 兩項 CI success；已回讀主線 evidence：completed、model_inference_verified=true、3 次請求、204 output tokens。AC-04 與其 T-0002-04 待辦一併結案，完整 MVP 仍 incomplete。

## T-0008：Grok 原生啟動與隔離

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0008-01 | 原生登入等待、隔離與清理已驗證及交付 | AC-01、AC-03（前置） | done | 2026-10-31T18:31:19Z | 2026-10-31T18:38:03Z | 2026-10-31T18:38:30Z |

本輪先驗證固定官方 CLI 的原生啟動，OS 阻擋外部網路、不載入 owner 登入檔、不接受 prompt；AC-03 真實任務保持 pending。

T-0008：47 項離線測試及原生啟動驗收通過，詳見[證據](../evidence/grok-startup-2026-11-01.json)。未載入 owner auth、未送 prompt，登入後 session hook／真實任務仍未驗收。

T-0008 [PR #864](https://github.com/fallrising/newclear/pull/864) 已合併，commit `46845e4aacd6c8de2eeedacfd4f61e2fc100d7cc`。offline／validate 兩項 CI success；已回讀主線證據：startup completed、login_required、cleanup_completed=true、model_inference_verified=false。這只完成啟動前置，AC-03 與其 T-0002-03 保持待驗，沒有付費呼叫、release／deploy／usable tag。

## T-0009：Cursor Agent 第四工位接入

Owner 明確要求加入 Cursor Agent；先固定官方 CLI、缺失／版本偵測、隔離登入入口與無推論啟動驗收，真實任務另需登入及有界配額授權。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0009-01 | Cursor 固定安裝、隔離設定及原生啟動已驗證及交付 | AC-01、AC-13（前置） | done | 2026-10-31T18:41:54Z | 2026-10-31T18:48:30Z | 2026-10-31T18:48:52Z |
| T-0009-02 | Cursor 真實任務 AC-13 通過並交付；完整生命週期待後續 | AC-13；其餘生命週期待驗 | done | 2026-10-31T18:57:23Z | 2026-11-01T04:32:33Z | 2026-11-01T04:33:09Z |

T-0009-01：55 項離線測試、真實官方 archive 提取／摘要與無憑證原生啟動通過。[證據](../evidence/cursor-startup-2026-11-01.json)。T-0009-02 仍待登入與有界真實任務，不把前置當 AC-13 通過。

T-0009-01 [PR #869](https://github.com/fallrising/newclear/pull/869) 已合併，commit `5e4c1a6f5c427433b4897905ab59c988f1f90658`。offline／validate 兩項 CI success；已回讀主線證據：login_required、workspace_hooks_removed=true、model_inference_verified=false。T-0009-02／AC-13 保持待驗；owner 下一步只需執行 [隔離登入](../CURSOR.md)，不需交出憑證，本次未做付費呼叫。

T-0009-02：登入已核對；[runner 與具體上限](../CURSOR-WORK.md)可供審閱，真實任務結果見下方，AC-13 保持 pending。

T-0009-02 本次執行與修正見[證據](../evidence/cursor-live-2026-11-01.json)：一個模型任務已執行、產物正確，hooks 未生效故不通過。已修正並完成無 prompt 回歸，沒有自動重跑；PR #878 保持 draft。

最新單次批准已使用：240 秒期限下於 34.05 秒因第二個 Read 被邊界拒絕而停止，沒有產物；session／固定模型／hooks 有證據，清理完整。第二次讀取的目標未記錄，不能確認它是否為輸出檢查。已離線準備最多四次工具規則、預建空 result.json 與檔案分類診斷；65 tests 和無 prompt 啟動通過，尚未再次跑模型。[本輪證據](../evidence/cursor-bounded-2026-11-01.json)。AC-13 保持 pending、PR #878 保持 draft；下一次付費任務須新批准。

T-0009-02 的第三次獨立授權任務通過 AC-13：Composer 2.5，15.57 秒，Read(input) → Read(result) → Write(result)，原生同 session／model、completed stop、37723 input／424 output tokens、精確產物 hash 與完整清理一致。[成功證據](../evidence/cursor-completed-2026-11-01.json)。前兩次失敗保留；本次授權已使用，沒有自動重跑。65 項離線測試通過；PR #878 待 CI／合併，完整 MVP 仍 incomplete。

T-0009-02 結案：[PR #878](https://github.com/fallrising/newclear/pull/878) 已合併，commit `c73950eccab2263e8b22e383c55b20899c98d186`，offline／validate 兩項 CI success。已回讀主線成功證據：completed、model_inference_verified=true、424 output tokens、cleanup completed。AC-13 通過；前兩次失敗保留，本次單次授權已使用，無追加模型任務。完整四工位 MVP、Grok 真實任務及 Cursor 權限／取消／恢復仍待驗；沒有 release／deploy／usable tag。此列與結案紀錄更新 HANDOFF 內合併前的「待 CI／合併」狀態。

## T-0010：Grok 登入後有界任務

Owner 指示繼續開發；先完成原生協定、隔離憑證副本、工具 gate、無 prompt 啟動及離線測試，再提出單次付費驗收範圍。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0010-01 | Grok 真實任務 AC-03 通過並合併交付 | AC-03 | done | 2026-11-01T04:50:31Z | 2026-11-01T11:02:40Z | 2026-11-01T11:03:20Z |

T-0010 已準備 Grok 1.0.70／grok-4.6 單任務 runner：原生 inspect 確認 hooks、已登入無 prompt 啟動與同 session 模型選擇、清理通過（12.52 秒）；78 項離線測試通過。[證據](../evidence/grok-ready-2026-11-01.json)、[單次範圍](../GROK-WORK.md)。沒有送模型 prompt；AC-03 仍 pending，等 owner 明確批准一次付費驗收。四工具 hook gate 會受原生 fail-open 行為限制，沒有 request／token／金額硬上限。

T-0010 的一次已授權 Grok 任務已執行，12.55 秒後因 lab 只識別 file_path、未識別原生 read_file 的 target_file 而停止；兩次讀取請求被拒，seed output 未變，AC-03 未通過。原生 session／模型／prompt 正確，程序與憑證副本清理完整。[失敗與離線修正](../evidence/grok-live-2026-11-01.json)：已支援無歧義路徑別名、兩檔並行讀取、按 tool ID 核對完成，保留四次工具 gate／唯一編輯；80 tests 通過。沒有追加付費重跑；PR #897 保持 draft，等新的單次批准。

T-0010 最新：owner 再批准一次翻倍範圍後，Grok 1.0.70／grok-4.6 真實任務通過 AC-03，18.00 秒完成兩個 read_file 與一個 search_replace；同 session 模型、authenticated hooks、成功工具結果、end_turn Stop、精確產物 hash 與清理一致。[成功證據](../evidence/grok-completed-2026-11-01.json)。81 項離線測試通過；先前失敗保留，本次授權已使用、沒有自動重跑。交付及結案狀態見[任務板](BOARD.md)。四 provider 各有合成任務證據，但統一產品流程、權限／取消／恢復及完整 MVP 尚未完成。

T-0010／T-0002-03 結案：[PR #897](https://github.com/fallrising/newclear/pull/897) 已合併，commit `bd96e88f269d5f25d62ad38c62ded1c0d516992d`，offline／validate 兩項 CI success。已回讀主線成功證據：completed、model_inference_verified=true、三次工具、18.00 秒、cleanup completed。前次失敗及原受測來源 hash 保留；本次單次授權已用完，沒有追加模型呼叫。四 provider 各有合成任務成功證據，完整 MVP 仍 incomplete；下一步為統一工位／結果入口與剩餘權限、取消及恢復驗收，沒有 release／deploy／usable tag。

## T-0011：四 provider 唯讀結果入口

Owner 指示繼續開發；整合既有真實結果，不新增模型呼叫。完整 AC 保持 pending。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0011-01 | 統一結果查詢、產物重驗與離線互動頁 | AC-09 子集 | done | 2026-11-01T11:14:35Z | 2026-11-01T11:21:14Z | 2026-11-01T11:21:43Z |
| T-0011-02 | 白名單輸出、檔案讀取及頁面注入邊界 | AC-11 子集 | done | 2026-11-01T11:14:35Z | 2026-11-01T11:21:14Z | 2026-11-01T11:21:43Z |

T-0011 結案：[PR #911](https://github.com/fallrising/newclear/pull/911) 已合併，commit `f453733530771cb6fbe79b781d0a08e21de6e15e`，offline／validate 兩項 CI success。已回讀主線證據：96 tests、33 筆歷史 run、四 provider 產物重驗、Chrome 篩選／詳細內容／刷新通過，0 外部請求、0 新模型呼叫。完成 AC-09 結果入口及 AC-11 讀取／顯示子集；完整 AC 保持 pending。下一步為統一偵測／派工與跨 provider 權限、取消及恢復，沒有 release／deploy／usable tag。

## T-0012：統一偵測與單任務派工

Owner 指示繼續開發；本輪不新增模型呼叫，完整 AC 保持 pending。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0012-01 | 四 CLI 偵測、固定計畫與明確派工入口 | AC-01 子集 | done | 2026-11-01T11:39:35Z | 2026-11-01T11:51:09Z | 2026-11-01T11:51:32Z |
| T-0012-02 | 共用執行鎖、清理確認及異常退出阻擋 | AC-08／AC-11 子集 | done | 2026-11-01T11:39:35Z | 2026-11-01T11:51:09Z | 2026-11-01T11:51:32Z |

T-0012 結案：[PR #916](https://github.com/fallrising/newclear/pull/916) 已合併，commit `1ba325266fed588ab9388fea5cfb689b9c160c59`，offline／validate 兩項 CI success。已回讀主線證據：117 tests、四 CLI 的實際斷網版本／help 檢查通過；exec 鎖繼承、直接 runner 互斥、強制中斷後阻擋通過。0 新模型呼叫、未啟動 Strata。完成 AC-01 偵測／派工 gate 與 AC-08／AC-11 執行保護子集；完整 AC 保持 pending，歷史模型成功證據沒有冒充新入口驗收。下一步為新入口端到端任務與跨 provider 生命週期；沒有 release／deploy／usable tag。

## T-0013：本地派工端到端與取消驗收

Owner 指示繼續開發；本輪僅執行本地模型，不新增遠端付費呼叫。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0013-01 | 新入口本地合成任務、互斥與產物回讀 | AC-01／AC-02／AC-09 子集 | done | 2026-11-01T14:26:04Z | 2026-11-01T14:36:21Z | 2026-11-01T14:36:48Z |
| T-0013-02 | 原生取消及 runner 中斷清理、執行鎖釋放 | AC-06／AC-08 子集 | done | 2026-11-01T14:26:04Z | 2026-11-01T14:36:21Z | 2026-11-01T14:36:48Z |

T-0013 結案：[PR #923](https://github.com/fallrising/newclear/pull/923) 已合併，commit `d93067baa4da7222fddde41b688939329595c961`，offline／validate 兩項 CI success。已回讀主線證據：122 tests、三個真實本地 run（最終原生取消及程序退出 202 ms；Ctrl+C 整體退出 10.399 秒），所屬程序全部退出、執行鎖釋放、重複派工拒絕、完成／取消結果與瀏覽器核對通過。0 遠端模型呼叫，本地模型已停止。完成新入口本地 AC-01／02／09 與取消／中斷 AC-06／08 子集；遠端新入口與跨 provider 生命週期仍待驗，完整 MVP incomplete，沒有 release／deploy／usable tag。

## T-0014：Pi 原生 401／429 故障驗收

Owner 指示繼續開發並盤點剩餘任務；本輪以本機錯誤回應驅動真實 Pi，不呼叫遠端模型。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0014-01 | 原生 Pi 的 401／429 失敗分類、停止重試及清理 | AC-07 子集 | done | 2026-11-01T14:54:05Z | 2026-11-01T15:12:30Z | 2026-11-01T15:12:57Z |
| T-0014-02 | 無憑證／外部請求的故障注入邊界與結果顯示 | AC-09／AC-11 子集 | done | 2026-11-01T14:54:05Z | 2026-11-01T15:12:30Z | 2026-11-01T15:12:57Z |

T-0014 結案：[PR #935](https://github.com/fallrising/newclear/pull/935) 已合併，commit `8c2459de277b3793832a4c9cf4af055952085502`，offline／validate 兩項 CI success。已回讀主線證據：135 tests、四筆 Pi 本機注入故障紀錄，最終 401／429 各一次本機請求、零外部模型請求、原生錯誤／無產物、所屬程序全退出後釋放執行鎖；原兩筆清理證據不足紀錄保留。結果頁的四筆任務均為失敗，僅最終兩筆故障驗收通過；40 筆結果瀏覽器核對通過。沒有載入 owner API key、啟動 Strata 或付費推論。完成 AC-07／09／11 子集；CLI crash、其他 provider、顯式重試與完整 MVP 仍 pending，沒有 release／deploy／usable tag。

## T-0015：Pi CLI crash 與明確重新啟動

Owner 指示繼續；本輪不呼叫遠端模型、不載入 owner API key。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0015-01 | 真實執行中 Pi CLI crash、退出分類及程序清理 | AC-07 子集 | done | 2026-11-01T15:24:51Z | 2026-11-01T15:31:55Z | 2026-11-01T15:32:15Z |
| T-0015-02 | 不自動重跑、明確新 session 啟動及結果回讀 | AC-08／09／11 子集 | done | 2026-11-01T15:24:51Z | 2026-11-01T15:31:55Z | 2026-11-01T15:32:15Z |

T-0015 結案：[PR #938](https://github.com/fallrising/newclear/pull/938) 已合併，commit `599a5c743d0c4b4cd3367b04016e3cde99038f3e`，offline／validate 兩項 CI success。已回讀主線證據：141 tests、兩筆真實 Pi CLI crash 與一筆明確新 session 啟動；最終 crash／啟動各追蹤 40／38 個程序且全部退出，清理後釋放執行鎖、重複派工拒絕、觀察期無自動重跑。crash 任務仍為 failed，新 session 為 startup_only；43 筆結果瀏覽器驗證通過。零遠端模型請求、未載入 owner key 或 Strata。完成 AC-07／08／09／11 子集；原 session 續做、其他 provider、host restart、最多兩次顯式任務重試與完整 MVP 保持 pending，沒有 release／deploy／usable tag。

## T-0016：Pi 有界顯式重試

Owner 指示繼續下一項；本輪使用本機故障，不新增模型呼叫。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0016-01 | Pi 重試計畫／執行與持久化最多兩次限制 | AC-07／08 子集 | done | 2026-11-01T16:44:12Z | 2026-11-01T16:54:06Z | 2026-11-01T16:54:34Z |
| T-0016-02 | 保留 fixture／失敗來源、結果關聯與真實故障重試驗收 | AC-09／11 子集 | done | 2026-11-01T16:44:12Z | 2026-11-01T16:54:06Z | 2026-11-01T16:54:34Z |

T-0016 結案：[PR #947](https://github.com/fallrising/newclear/pull/947) 已合併，commit `adbc2dda0ac037a947201a1320e0591745fbcc93`，offline／validate 兩項 CI success。已回讀主線證據：152 tests；真實 Pi 本機 429 初次＋兩次明確重試，三個獨立 session、相同 fixture、原報告／事件不變；第三次及過期 parent 的 plan／execute 六項全部拒絕，不新增 run。三次追蹤 41／35／46 個程序全部退出，執行鎖釋放，46 筆結果的瀏覽器關聯／分類／刷新通過。零本地或遠端模型推論、未載入 owner key 或 Strata。完成 AC-07／08／09／11 的 Pi 子集；其他 provider 重試／生命週期、UI 派工、安全整合及完整 MVP 仍 pending，沒有 release／deploy／usable tag。

## T-0017：本機操作台與原生終端入口

Owner 指示繼續開發；整合 UI 到已驗證的本地流程，不新增付費呼叫。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0017-01 | 四工位偵測／計畫、本地派工與產物整合 | AC-01／09 子集 | done | 2026-11-02T10:58:58Z | 2026-11-02T11:26:51Z | 2026-11-02T11:27:15Z |
| T-0017-02 | 一次性執行、同來源授權、刷新及所屬 runner 停止 | AC-06／08／11 子集 | done | 2026-11-02T10:58:58Z | 2026-11-02T11:26:51Z | 2026-11-02T11:27:15Z |

T-0017 結案：[PR #965](https://github.com/fallrising/newclear/pull/965) 已合併，commit `9f384a6d3c4f9d27e522ef860fff815b063b3623`，offline／validate 兩項 CI success。已回讀主線白名單證據：159 tests，Chrome 四工位偵測／計畫、Pi 本機 429、本地 OpenCode／Strata 派工、原生終端開啟／刷新／再次開啟、重複提交拒絕、產物詳細頁與停止通過。最終 107 個追蹤程序全退出、鎖釋放，52 筆結果回讀；零付費呼叫。首輪表單等待失敗及第二輪 swap guard 停止均保留，未放寬資源限制，最終重驗通過。完成 AC-01／06／08／09／11 子集；一般任務、完整四工位 UI／生命週期與安全驗收仍 pending，沒有 release／deploy／usable tag。

## T-0018：Pi 原生取消與操作台驗收

Owner 指示繼續開發；本輪使用真實 Pi 與本機 held request，不載入 owner key 或模型。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0018-01 | 原生 working 取消、所屬程序清理與無自動重跑 | AC-06／08 子集 | done | 2026-11-02T12:15:30Z | 2026-11-02T12:30:18Z | 2026-11-02T12:30:55Z |
| T-0018-02 | 取消入口授權互斥、頁面結果與重試拒絕 | AC-09／11 子集 | done | 2026-11-02T12:15:30Z | 2026-11-02T12:30:18Z | 2026-11-02T12:30:55Z |

T-0018 結案：[PR #977](https://github.com/fallrising/newclear/pull/977) 已合併，commit `127e3fe1749e7c56cd1831c6cbe819f08b9e7bf0`，offline／validate 兩項 CI success。已回讀主線證據：163 tests；真實 Pi held request／原生 worker.kill，工位移除及 PID 退出 102 ms、整體清理 3.521 秒，最終外層追蹤 29 個程序全退出、執行鎖釋放。Chrome 操作台及 55 筆唯讀結果回歸通過，取消保持 cancelled、不重跑、不可重試；零模型推論與付費呼叫。首輪約 20.09 秒清理延遲及第二輪背景子程序殘留保留，第二輪鎖在事後逐一核對程序全退出後明確歸檔；最終只對本次已觀察且身分相符的後代送 SIGTERM。完成 AC-06／08／09／11 子集；其他 provider、原 session 恢復、遠端取消及完整安全驗收仍 pending，沒有 release／deploy／usable tag。

## T-0019：操作台重啟與共用執行狀態

Owner 指示繼續開發；本輪使用真實程序與瀏覽器，不執行模型。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0019-01 | 跨入口持鎖與中斷狀態、重啟不重跑 | AC-08 子集 | done | 2026-11-02T12:36:43Z | 2026-11-02T12:47:03Z | 2026-11-02T12:47:29Z |
| T-0019-02 | 唯讀邊界、派工重新檢查與頁面阻擋提示 | AC-11 子集 | done | 2026-11-02T12:36:43Z | 2026-11-02T12:47:03Z | 2026-11-02T12:47:29Z |

T-0019 結案：[PR #982](https://github.com/fallrising/newclear/pull/982) 已合併，commit `e0cdbfba39927aad33d5088c78fe84c7f3bc0952`，offline／validate 兩項 CI success。已回讀主線證據：171 tests、真實 helper 程序與 Chrome 持鎖／SIGKILL／兩次操作台啟動／刷新驗收；中斷 journal 內容與修改時間不變，舊計畫被阻擋，明確核對退出後歸檔保留原紀錄，損壞狀態不洩漏且不放行。新增唯讀 status CLI；不建立狀態檔、不接管程序、不自動解鎖或重跑。所有測試程序退出，零 provider／模型啟動與付費呼叫。完成控制層 AC-08／11 子集，原生 provider host restart／session 恢復、遠端整合及完整安全驗收仍 pending，沒有 release／deploy／usable tag。

## T-0020：Pi 原生同 session 明確重新連接

Owner 指示繼續；使用真實 Pi、本機 429，不載入 owner key 或呼叫模型。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0020-01 | 原生 CLI 退出後同 session 明確重新連接、歷史保留與不重跑 | AC-08 子集 | done | 2026-11-02T14:04:20Z | 2026-11-02T14:20:43Z | 2026-11-02T14:21:23Z |
| T-0020-02 | 一次性恢復 gate、派工／結果整合與程序清理 | AC-09／11 子集 | done | 2026-11-02T14:04:20Z | 2026-11-02T14:20:43Z | 2026-11-02T14:21:23Z |

T-0020 結案：[PR #990](https://github.com/fallrising/newclear/pull/990) 已合併，commit `ff1ac79b08d2c4253353256917205a32f893bb69`，offline／validate 兩項 CI success。已回讀主線證據：177 tests、真實 Pi 1.4.0 及 Chrome 驗收通過。原生 CLI 退出後，一次性無 prompt resume 以新 PID 接回相同 session、更新 hook token、保留六筆歷史，無自動重送；結果保持 stopped、原任務未完成。最終 runner 17.72 秒、外層 30 個程序全退出、鎖釋放；57 筆結果頁回歸通過。首輪瀏覽器欄位名稱筆誤保留，修正後完整重驗通過；兩輪原生檢查皆通過、零模型推論與付費呼叫。完成 AC-08／09／11 子集；Office host crash、任務續做、其他 provider 與完整 MVP 仍待驗，沒有 release／deploy／usable tag。

## T-0021：本地文字任務與專案選擇

Owner 指示繼續，Claude 額度 23:50 重置前先做其他工作；本輪只用本地 OpenCode／Strata。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0021-01 | 登記工作目錄、自訂文字任務、產物查看與下載 | AC-01／09 子集 | done | 2026-11-02T15:22:39Z | 2026-11-02T15:49:49Z | 2026-11-02T15:50:27Z |
| T-0021-02 | 文字快照／工具邊界、一次性執行與來源不變驗收 | AC-11 子集 | done | 2026-11-02T15:22:39Z | 2026-11-02T15:49:49Z | 2026-11-02T15:50:27Z |

T-0021 結案：[PR #999](https://github.com/fallrising/newclear/pull/999) 已合併，commit `be2e1923ae6c48cc039c68d87857255c3873999e`，offline／validate 兩項 CI success。已回讀主線證據：184 tests、真實 OpenCode／Strata 文字任務與 Chrome 操作／下載、61 筆結果回歸通過。最終獨立 HOME 任務 43.12 秒，來源目錄與快照保留、工具僅 read／write、產物與下載 hash 一致；關閉／重開瀏覽器沒有重跑，外層 71 個程序全退出、鎖釋放、swap 增量 0。首輪完整流程通過，中間兩次資源 guard 停止與啟動前測試失敗均保留，沒有放寬限制。完成本地 AC-01／09／11 子集；原目錄不寫回，內容仍需確認，一般程式修改、遠端工位與完整隔離／MVP 仍 pending。未使用 Claude 或遠端模型，沒有 release／deploy／usable tag。

## T-0022：本地單檔修改提案

Owner 指示繼續開發；以本地 Strata 產生可審閱的單檔替代內容，不自動寫回來源。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0022-01 | 專案選檔、自訂修改、差異預覽與替代檔下載 | AC-01／09 子集 | done | 2026-11-02T16:14:53Z | 2026-11-02T16:32:04Z | 2026-11-02T16:32:42Z |
| T-0022-02 | 目標／快照邊界、原檔保留及提案重算驗收 | AC-11 子集 | done | 2026-11-02T16:14:53Z | 2026-11-02T16:32:04Z | 2026-11-02T16:32:42Z |

T-0022 結案：[PR #1008](https://github.com/fallrising/newclear/pull/1008) 已合併，commit `ea6e429c994d4637e1b40a6f4304ac02d9a38db5`，offline／validate 兩項 CI success。已回讀主線證據：190 tests、真實 OpenCode／Strata 單檔修改提案與 Chrome 選檔／差異／下載、62 筆結果回歸通過。測試提案將減法修正為加法，獨立 AST 核對通過但未執行生成程式；原目錄與快照不變。runner 42.92 秒、外層 73 個程序全部退出、鎖釋放、swap 增量 44.19 MiB，資源限制未放寬。離線變數命名與測試暫存路徑問題於原生驗收前修正；零遠端模型呼叫。完成 AC-01／09／11 子集；提案仍須人工審閱，多檔修改、自動測試／套用、遠端入口及完整 MVP／安全驗收仍 pending，沒有 release／deploy／usable tag。

## T-0023：Pi Office host 重啟

Owner 指示繼續開發；真實 Pi、本機 429，零模型呼叫。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0023-01 | Host crash、重複重啟、明確同 session 重新連接 | AC-08 子集 | done | 2026-11-06T15:16:20Z | 2026-11-06T15:25:51Z | 2026-11-06T15:26:30Z |
| T-0023-02 | 一次性 gate、結果與瀏覽器、歷史及程序清理驗收 | AC-09／11 子集 | done | 2026-11-06T15:16:20Z | 2026-11-06T15:25:51Z | 2026-11-06T15:26:30Z |

T-0023 結案：[PR #1033](https://github.com/fallrising/newclear/pull/1033) 已合併，commit `03edf45eb3593064ef74a643201389862d1cba9f`，offline／validate 兩項 CI success。已回讀主線證據：195 tests、真實 Pi 1.4.0／三代 Office host／Chrome 首輪驗收，以及 63 筆結果回歸通過。一次本機 429 後對已核對所屬 host 注入 SIGKILL，重啟後保持 interrupted，重複重啟與刷新不重跑；明確一次性無 prompt 重連到相同 session、新 PID，六筆歷史保留。runner 41.06 秒，外層 83 個程序全退出、鎖釋放；正常關閉後兩個已追蹤背景程序經身分核對送 SIGTERM，確認無殘留。零模型推論與外部請求，任務保持 stopped。完成 AC-08／09／11 子集；進行中遠端串流恢復、任務續做、其他 provider 與完整安全／MVP 仍 pending，沒有 release／deploy／usable tag。

## T-0024：委託指導與 Pi 遠端操作台授權

Owner 指示 Claude Opus 5.5 指導、Pi agent 實作，可獨立部分平行開發。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0024-01 | Claude 指導完成；Pi 後端實作授權／派工 | AC-01／11 子集 | done | 2026-11-06T15:39:34Z | 2026-11-06T16:43:13Z | 2026-11-06T16:43:50Z |
| T-0024-02 | Pi 介面平行實作及整合驗收 | AC-06／09 子集 | done | 2026-11-06T15:39:34Z | 2026-11-06T16:43:13Z | 2026-11-06T16:43:50Z |

T-0024 結案：[PR #1036](https://github.com/fallrising/newclear/pull/1036) 已合併，commit `a7ec5cc7af24288e879f1a0ec726be8b2c9c0784`，offline／validate 兩項 CI success。已回讀主線證據：218 tests、五組 Chrome 授權測試替身、真實 Pi 本機 429／取消及 65 筆結果回歸通過。Claude Opus 5.5 實際提供指導，兩個 Pi CLI（OpenAI GPT-5.5）獨立工作區平行實作；後端到達 24 次請求上限後由主導 agent 完成審查與整合。持久化一次性 grant、CLI 建立與 console opt-in、先鎖及預檢後消耗、崩潰不退還、刷新／重啟不重跑及遠端 retry 隔離通過；實際消耗與未知用量保守顯示。94／46／29 個受追蹤程序全部退出，鎖釋放，取消清理 3.521 秒。開發 API 用量與產品驗收分開：產品零模型推論／遠端請求、未建立真實付費 grant，沒有本地 Strata 推論。新入口到 DeepSeek 產物及遠端串流停止仍待另次明確批准與實測，完整 MVP／安全驗收保持 pending，沒有 release／deploy／usable tag。

## T-0025：Pi 原生問答與確認

Owner 指示維持 Claude 指導、Pi 實作的協作模式，繼續開發；產品驗收不呼叫付費模型。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0025-01 | 原生確認流程、拒絕／接受與零請求 gate | AC-05／11 子集 | done | 2026-11-07T04:05:44Z | 2026-11-07T04:23:21Z | 2026-11-07T04:23:53Z |
| T-0025-02 | 固定派工、結果／介面與原生驗收 | AC-09 子集 | done | 2026-11-07T04:05:44Z | 2026-11-07T04:23:21Z | 2026-11-07T04:23:53Z |

T-0025 結案：[PR #1039](https://github.com/fallrising/newclear/pull/1039) 已合併，commit `5d6d78c208daa98a6d16a9f3c27ed58ea278f17f`，offline／validate 兩項 CI success。已回讀主線證據：248 tests、兩輪真實 Pi 確認介面與 67 筆結果瀏覽器回歸通過；同 session 拒絕／接受／原生逾時、重複指令拒絕，只有接受寫一次私有 marker。外層 43／35 個程序全部退出、鎖釋放；結果 stopped、零 relay／產品模型請求，沒有 Strata 推論或真實付費 grant。Claude Opus 5.5 實際指導，兩個 Pi CLI（OpenAI GPT-5.5）平行實作，各達 24 次請求上限後由主導 agent 完成審查；開發用量估算合計 2.98099 美元，非帳單，臨時憑證副本已移除。完成 AC-05／09／11 子集；模型驅動權限、其他 provider、遠端端到端及完整 MVP／安全仍 pending，沒有 release／deploy／usable tag。[證據](../evidence/pi-question-2026-11-07.json)。


## T-0026：Pi hook 身分與 session 邊界

Owner 要求維持原開發協作方式繼續；本輪不啟動產品付費模型。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0026-01 | Claude 指導、Pi 邊界實作與負向測試 | AC-11 子集 | done | 2026-11-07T08:33:39Z | 2026-11-09T18:36:24Z | 2026-11-09T18:38:03Z |
| T-0026-02 | 真實 hook 入口／重新連接回歸及清理 | AC-08／11 子集 | done | 2026-11-07T08:33:39Z | 2026-11-09T18:36:24Z | 2026-11-09T18:38:03Z |

T-0026 本地實作與驗收完成：[指導／委託](../T26-TECHNICAL-GUIDANCE.md)、[白名單證據](../evidence/pi-hook-boundary-2026-11-07.json)。268 tests、21 repo tests、1680 組真實 parser 比較與四輪原生驗收通過；[PR #1041](https://github.com/fallrising/newclear/pull/1041) 的 offline／validate CI 通過並已合併，兩列依實際合併時間結案。來源 runtime 基準 `04a7340f05ade127f550539817f78411bfba9d2d`，整合主線 `64c8ad59620e9068f0beede99365b7d656f00825`；未修改 vendor，零產品模型請求。

T-0026 結案：[PR #1041](https://github.com/fallrising/newclear/pull/1041) 已於 `2026-11-09T18:36:24Z` 合併，commit `39a5e5a8748f934fb623fe0f73b1f88ed0bbe255`。遠端白名單證據已回讀一致：268 項元件測試、21 項 repo 契約測試與四條原生路徑通過；問答／啟動 11 種拒絕、重連舊 token 拒絕且狀態不變，host 重啟／Chrome 刷新及明確恢復正常。四輪 33／24／99／41 個受追蹤程序全退出、鎖釋放，零產品模型／外部請求。實際 Claude 指導與兩個 Pi worker 已完成、臨時憑證副本移除；已知回報開發小計 2.200252 美元，首次 Claude 逾時用量未知，非帳單。AC-08／11 僅子集，其他 provider、有效 token 的同 session 偽造、遠端端到端與完整 MVP 仍 pending；沒有 release／deploy／usable tag。

## T-0027：結果輸出的合成秘密遮蔽

Owner 直接指示；只推進 AC-11 子集。實作與本機驗收完成，PR／CI／合併狀態以本節交付紀錄為準。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0027-01 | 合成秘密結果投影、ref 與下載核對；PR #1044 已合併 | AC-11 子集 | done | 2026-11-15T14:46:06Z | 2026-11-16T16:26:15Z | 2026-11-16T16:26:56.396632Z |

來源：fallrising/newclear `2aa21f10b53ecaeb079279b6531bbb47a103e937` 的根 AGENTS／README、元件 AGENTS／README／SUCCESS／HANDOFF、docs/SDD.md、docs/tasks/BOARD.md、docs/T26-TECHNICAL-GUIDANCE.md、docs/evidence/pi-hook-boundary-2026-11-07.json、docs/SETUP.md、結果程式及契約；固定 vendor `852e2ab28c4f3f31bffdf4b20353bd119c9d3270`。共用交付規則 fallrising/desk docs/delivery-and-handoff.md，blob `13bf6ff32c6131208ef14e27619160c2906dcb32`（2026-11-15T14:46:06Z 回讀）；私有交接及 T26 runner 同日唯讀查核。

T-0027 進度保存（尚未實作／驗收／交付）：無憑證三站 DNS／HTTPS 可達，fetch 成功，主線差異只在 CMS。已更新目標／驗證計畫並建立獨立 worker 工作區。實際 Claude Opus 5.5 單次指導在 240.006 秒逾時；終止等待另計 0.449 秒，exit 124，stdout／stderr 均空，未取得指導或用量，費用未知。沒有自動重試、Pi 調用、產品模型請求或臨時 auth 副本。退出後按 runner argv／Claude cwd 查無相符程序；沒有持續追蹤整棵後代樹，不能宣稱完整程序樹稽核。

新 T27 私有有界 runner 已準備；實際 boundary extension 的五組離線檢查通過（24 次 request／6000 output cap、模型限制、US$3 回報成本、80 次工具及精確檔案／symlink 邊界），Python supervisor syntax 通過。這些不是產品遮蔽測試；元件功能與瀏覽器／下載驗收未跑，CI／PR／合併未完成。工具執行及終止等待如上；批准等待與總主動工時未可靠量測。Owner 要求先保存並提交進度；下一步需要新的單次 Claude 指導授權，不擴大原單次上限；指導成功才凍結秘密／hash 契約並啟動 Pi。AC-11 保持 pending，沒有 usable tag。

進度提交前檢查：repo 根 `python3 scripts/check_indexes.py` 首次因系統 Python 3.14.4 缺 OpenCC 失敗；依 `.github/workflows/project-success.yml` 在私有 T27 venv 安裝固定 `opencc-python-reimplemented==0.1.7`，使用該 venv Python 執行同一 `scripts/check_indexes.py` 通過（55 project contracts、9 llms、零導航錯誤）。repo 根 `python3 labs/agent-office-lab/scripts/check_publication.py` 通過（205 public source files、syntax、local links）。這次提交只有規格／進度文件；未重跑未受影響的產品測試或歷史原生驗收。

T-0027 接續保存：新版串流擷取已取得完整 Claude Opus 5.5 六項指導（67.684 秒，估算 US$0.1817778，非帳單）；依 owner 新批准，本次上限為 480 秒／CLI US$3.00。主導核對現有介面後固定[輸出契約](../RESULT-REDACTION.md)。兩個實際 Pi CLI（設定 openai/gpt-5.5）各第一個請求遭 401 expired_secret_key 拒絕，零工具／零程式改動、willRetry=false；CLI exit 0 不當作成功，服務端模型身分未確認。各一個受追蹤程序退出、臨時憑證副本移除，抽樣追蹤不代表完整後代樹稽核。未自動重試／更換模型，產品模型請求零；功能測試／PR／CI 尚未完成。下一步更新本機 Pi OpenAI 憑證並授權新一次有界 worker 委託，沿用完整 Claude 契約，不需再次 Claude 指導。[進度證據](../evidence/result-redaction-progress-2026-11-16.json)。

T-0027 實作驗收：owner 更新憑證後明確批准兩 Pi 各一次；backend 239.825 秒／20 次請求／估算 US$1.023503，UI 159.059 秒／17 次請求／估算 US$0.805637，均回報 gpt-5.5 與正常 stop。原每 worker 720 秒／24 requests／80 tools／6000 output cap／US$3 回報停止門檻保留，無自動重試／模型替換。主導修正 literal 遮蔽名稱身分、矛盾差異 fail closed、CLI 同名歧義，補 Console ref lookup 與實際 HTTP／CLI 測試。兩 Pi 憑證副本已移除，受追蹤程序退出；非完整後代樹保證。產品模型請求零；[本機證據](../evidence/result-redaction-2026-11-16.json)，完整 AC-11／MVP 仍 pending。下方／先前等待授權描述只保存歷史。

T-0027 交付結案：[功能 PR #1044](https://github.com/fallrising/newclear/pull/1044) 已於 2026-11-16T16:26:15Z 正常合併，遠端 main SHA `2a02f146a398dfa89a995196c7c96f805320e8af`；fetch 後與候選 HEAD `42c36a51500b0a6d4180550959d9963a64de5679` 的整個元件內容 diff 為零。必要 CI [Agent Office Lab](https://github.com/fallrising/newclear/actions/runs/43907258865) 與 [Project success contracts](https://github.com/fallrising/newclear/actions/runs/43907258899) 均 success，無衝突；主導完成程式審查，未宣稱獨立外部審查。215 Python／68 Node、實際 HTTP／CLI／Chrome 六次下載、publication／indexes／staged diff check 通過；完整測試命令與替身界線見上述白名單證據。沒有新增付費呼叫、retry execution、provider 原生重驗或 usable tag；完整 AC-11／MVP 仍 pending。本次只將已合併的 T27 子集標 done，後續安全主線另定範圍。

## T-0028：Pi 遠端重試一次性授權

Owner 直接指示繼續開發；T-0028：Pi 遠端重試的一次性授權。CLI 明確建立綁定指定失敗 parent／root／下一次 attempt／fixture 與歷史摘要的 grant，操作台透過既有 ref 選取與明確確認執行；首次 grant 與 retry grant 不可互用。保留固定模型／限額、最多兩次重試、單一 pending grant、來源綁定、共用執行鎖與消耗後不退還。主導直接實作，零新增開發模型委託／產品模型請求，不建立實際 lab 的付費授權。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0028-01 | 綁定失敗parent的遠端重試grant；PR #1050已合併 | AC-07／09／11 子集 | done | 2026-11-16T17:06:54.252682Z | 2026-11-16T17:20:19Z | 2026-11-16T17:21:26.909940Z |

驗證計畫：原始失敗、receipt、ledger、fixture 與來源綁定；錯 parent、過期／撤銷、兩次上限、競態與重啟、預檢失敗不消耗、消耗後啟動失敗不退還。實際 loopback HTTP 與 Chrome 使用隔離臨時 lab／測試程序驗證計畫、明確點擊、重複提交與刷新；不以替身宣稱 DeepSeek 推論或完整 AC 通過。元件 Python／Node／publication 與 repo indexes gates，PR／CI／正常合併後結案。

來源：fallrising/newclear `fead565acb877453861b6895471326096b923f0b` 的根與元件 AGENTS／README、SUCCESS／SDD／HANDOFF、T24-TECHNICAL-GUIDANCE、REMOTE-GRANT、RETRY、RESULT-REDACTION 及對應程式／測試。沿用已核對的共用 delivery-and-handoff 政策（blob `13bf6ff32c6131208ef14e27619160c2906dcb32`）。

T-0028 本機驗收完成：224 Python／68 Node、四組實際 HTTP／Chrome 重試情境及五組既有首次授權回歸通過。成功情境確認實際 dispatcher exec、同 PID 繼承執行鎖、grant 消耗與 attempt=1 receipt；舊報告／input／receipt hash 未變，fixture 相同，結果仍 failed／零模型。26 個 PID/create-time 受追蹤程序已退出；抽樣不是完整後代樹保證。首次瀏覽器因斷言把本地化提示當原始 API code 而逾時，已修正並保留；其他測試準備失敗見[白名單證據](../evidence/remote-retry-grant-2026-11-16.json)。主導直接實作，沒有新 Claude／Pi 委託、產品模型呼叫或實際 lab 付費 grant。PR／CI／合併仍待完成，完整 AC 不變。

T-0028 交付結案：[功能 PR #1050](https://github.com/fallrising/newclear/pull/1050) 已於 2026-11-16T17:20:19Z 正常合併，merge SHA `747be27db5453f109ea233c130a37cb66261368f`。遠端 main fetch 後，與候選 `249b9de29efdffde1b8d739a2ff8e0fb9ebf6e20` 的 Agent Office Lab 全元件 diff 為零；同期主線其他變更僅在 fanzloud 文件。必要 CI [Agent Office Lab](https://github.com/fallrising/newclear/actions/runs/43917130599) 與 [Project success contracts](https://github.com/fallrising/newclear/actions/runs/43917130674) 均 success，無衝突；主導審查完成，沒有獨立外部審查聲稱。224 Python／68 Node、四組新重試與五組既有首次授權瀏覽器流程、publication 217files／indexes 55contracts 9llms／staged diff check通過。零新增開發模型委託、產品模型請求與實際lab付費grant；每次真實付費重試仍需另次明確批准，完整 AC-07／09／11／MVP pending，無usable tag。

## FZ-OFFICE-NAV — bounded result-view dependency

[Task/lead](../../../../platform/fanzloud/docs/tasks/FZ-OFFICE-NAV.task.md),
[contract](../../../../platform/fanzloud/docs/specs/SPEC-FZ-OFFICE-NAV.md).

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| FZ-OFFICE-NAV | Existing console results-only UI, original source login and no mutation | N01–N05 bounded source feature | done | 2026-11-22T13:47:50Z | 2026-11-22T14:06:45Z | 2026-11-22T14:07:44Z |

Same owner-directed navigation slice; no T29/grant/provider work, auth policy or
backend changes. Original Office AC/MVP and native terminal/session stay intact.

## T-0029：Pi／DeepSeek 操作台真實端到端驗收

T-0029：依 owner 指示，驗證一次 Pi／DeepSeek 從操作台到產物的真實有界任務。先做零模型預檢；固定 Pi 1.4.0、deepseek-flash、最多四請求、每請求 512 output tokens、180 秒、無金額硬上限，不自動重試、不新增開發模型委託。真實 CLI grant、Chrome 明確確認、dispatcher／relay／原生 Office Pi、同 session／model／read-write／agent_settled、結果與 Blob 下載 hash、刷新及操作台重啟不重跑、授權只消耗一次與所屬程序清理。範圍僅涵蓋 AC-01／04／08／09／11 的 Pi 子集；不擴大到遠端重試、原生終端自由互動或其他 provider。

驗證計畫：先完成環境與瀏覽器無模型準備，再執行已批准的一次付費固定任務；一旦 consume／execute 即不再派工。模型或瀏覽器失敗保留證據，後續只讀回既有結果。必要元件／repo gates、PR／CI／合併／讀回。完整 MVP 與 usable tag 不變。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0029-01 | Pi／DeepSeek 來源綁定重試、操作台產物／下載與交付完成 | AC-01／04／08／09／11（Pi 子集） | done | 2026-11-22T11:47:18Z | 2026-11-22T13:47:48Z | 2026-11-22T13:48:27Z |

T-0029 單次嘗試：實際 Chrome 確認與 grant 消耗成功，首個 DeepSeek 請求 HTTP 402；無推論成果、無產物，授權已使用、不自動重試。原生與外層受追蹤程序已退出、共用鎖 available；唯讀 Chrome 驗證刷新／操作台重啟與新 grant gate。224 Python／68 Node 通過；[證據](../evidence/pi-console-live-2026-11-22.json)。此任務仍 in_progress（等 owner），不以失敗記錄當作驗收完成，PR 保持 draft。

來源核對：newclear `30a5bc3c212cd912b8c507200ca041c50fc5744b` 的根／元件 AGENTS、README、SUCCESS、SDD、HANDOFF、REMOTE-GRANT、CONSOLE、SETUP、PI-REMOTE、REMOTE-SETUP 及受測程式；與 T28 merge 的元件內容一致。共用交付政策讀回 blob `13bf6ff32c6131208ef14e27619160c2906dcb32`；DeepSeek 官方錯誤碼於 2026-11-22 查核。

T29 接續：owner 已更新 Pi 廠商登入並補足 DeepSeek 餘額，要求繼續開發。唯讀 balance API 回 available；新一次指定既有失敗 parent 的重試已獲授權，仍限四請求／每請求512output／180秒，不自動重試，不改固定產品Pi版本或模型。新增廠商及Cursor先作零推論環境盤點，不把已登入當模型成功。

T29 接續驗收通過：3次HTTP200、2142input／185output tokens、30.51秒；相同原fixture、read→write、agent_settled、marker／total、原始與實際Blob下載hash通過。原HTTP402失敗/report/receipt/input未變，兩次獨立grant各用一次、不自動重試。刷新／操作台重啟不重跑，32個外層受追蹤程序全部退出，未額外送終止訊號。產品程式未改，沿用已通過224Python／68Node的同一受測來源；publication／indexes及本PR CI另核對。主導審查與真實Chrome畫面核對，未宣稱獨立外部審查。新增全域Pi廠商及Cursor只盤點登入／catalog，零開發模型委託。[成功證據](../evidence/pi-console-completed-2026-11-22.json)，交付PR #1056將轉ready，尚未結案。

T29 交付結案：[PR #1056](https://github.com/fallrising/newclear/pull/1056) 於2026-11-22T13:47:48Z正常合併，merge SHA `68e1b74f3138ba0cfef6d7dc024b7bbb0ad7a160`。已fetch遠端main，與候選 `b01b2b272f5cf0357ebbe1feb4dfa6d351ae195b` 的全元件diff為零；[Agent Office Lab CI](https://github.com/fallrising/newclear/actions/runs/45029249158)及[Project success contracts](https://github.com/fallrising/newclear/actions/runs/45029249247)皆success。真實指定重試／Blob下載通過，先前402失敗及兩次已消耗授權保留；沒有自動重試、額外模型委託或待執行產品任務。主導審查完成，沒有獨立外部審查聲稱；完整跨provider AC與MVP仍pending，無usabletag。

## FZ-OFFICE-NAV delivery closeout

[PR #1071](https://github.com/fallrising/newclear/pull/1071) merged normally at
`2026-11-22T14:06:45Z`, merge SHA `4dce076bde64549190b87ac836573b2c24bfad3f`.
Candidate `770418428f15d2ae56159e22e6c93ef30e3fc90a`; all required CI passed:
[Fanzloud](https://github.com/fallrising/newclear/actions/runs/45030754158),
[Office](https://github.com/fallrising/newclear/actions/runs/45030754209),
[contracts](https://github.com/fallrising/newclear/actions/runs/45030754188).
Fetched remote main and verified that the merge SHA is its ancestor. All 26
changed files other than Fanzloud BOARD are byte-identical to the tested candidate;
Fanzloud BOARD additionally preserves
upstream T049/PR1070 closure. No conflict or protection bypass.

Lead evidence gate: **ACCEPTED for N01–N05 bounded source feature**. Local 224 Office
Python / 74 Office Node, integrated 65 Node (59 Fanzloud +6 Office navigation),
publication218, indexes55/9, staged whitespace and local links passed. Actual
Chromium153 with real Office HTTP/auth and synthetic records passed navigation,
source-only login, reload/refresh, invalid/offline/denied states, unchanged source
bytes/mtime, zero POST/spawn, hash/download/tamper and explicit return to full Office.
Fresh-context independent source review ACCEPT; focused integration review ACCEPT
independently reran65 tests, verified hashes and preserved T049 code/tests and T29
records. Detailed acceptance and browser receipt remain in the linked task.

This post-merge record supersedes pre-merge pending notes in SUCCESS/task/evidence;
only this bounded feature is closed. Existing Office must run on the browser's
machine with compatible source UI; user enters only its port in Fanzloud and uses
the original private launch URL in the Office tab. Results-only is a UI restriction,
not a new readonly credential. Existing grant source binding remains enforced;
installing changed source may invalidate unused older grants, with no auto renewal.
Live private installation/deployment, live Rust/AP authentication and owner FN07
operation were not verified. Original product AC/MVP/usable tags remain unchanged.
No paid product calls, migration, deployment, credential change or next milestone.
Optional Claude advice was not executed: automatic approval review rejected its
possible cost before launch; no output or success from Claude is claimed.

## T-0030：Cursor 操作台一次性授權

Owner 直接指示繼續開發。基準來源 `fallrising/newclear@1c0483e86a825d764aed6356312cee1ff26ac3a4`，共用交付契約 blob `13bf6ff32c6131208ef14e27619160c2906dcb32`。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0030-01 | 固定 Cursor 首次任務 grant、操作台派工／停止與重啟控制層；真實模型及完整 AC 另驗 | AC-01／06／08／09／11 子集 | done | 2026-11-22T14:03:31.768915+00:00 | 2026-11-22T14:19:10Z | 2026-11-22T14:19:42.524068+00:00 |

T30 本機驗收：232 Python／74 Node、Cursor五組Chrome流程（含唯讀模式零POST及明確返回）、Pi首次五組與重試四組回歸通過。實際dispatcher／atomic consume／跨exec鎖；provider與環境偵測明示替身，零產品模型請求／實際lab授權。已保留並整合主線 `6c9cbd0ba596cd5f1ddd6c5466b99ce294dea1d3` 的FZ-OFFICE-NAV，未改其產品範圍。publication223／indexes55contracts9llms／staged diff check通過。單次Pi GLM審查403，未取得審查、無重試；主導審查，不宣稱獨立模型審查。PR／CI／合併尚待完成。

T30 交付結案：[功能 PR #1073](https://github.com/fallrising/newclear/pull/1073) 於 `2026-11-22T14:19:10Z` 正常合併，merge SHA `e0e6a3488ad4fdabaf99a65be004ada76230c830`。遠端main已fetch，與候選 `bcd6cbeb6762ed638c98684cafca8d8fb5f18215` 的全元件diff零；[Agent Office Lab CI](https://github.com/fallrising/newclear/actions/runs/45032075411)與[Project success contracts](https://github.com/fallrising/newclear/actions/runs/45032075486)均success，無衝突／繞過保護。232Python／74Node、Cursor五組及Pi首次五組／重試四組Chrome、唯讀成果零POST／明確返回、publication223／indexes55與9／staged check通過。最終畫面確認工作finished、執行鎖available。只有控制層使用實際HTTP／dispatcher／exec與明示provider替身；無產品模型請求／實際lab grant。一次Pi GLM開發審查403，未取得獨立審查、沒有自動重試；主導審查完成。Cursor真實新入口、原生取消／恢復及完整MVP仍pending，沒有usable tag或部署。

## T-0031：重新訂閱後的 GLM 審查與必要修正

T-0031：owner 重新訂閱 OpenCode 並要求繼續；新單次 Pi／GLM 5.3 唯讀審查已合併的 Cursor grant 控制流程，主導重現可驗證問題、修正必要邊界並交付。固定一請求、零工具、6000 output tokens、180秒、回報成本US$3後停止（非金額硬上限）；不自動重試／fallback。與產品模型驗收分開，沒有 Cursor 產品付費授權。驗證 AC-01／09／11 子集的來源綁定、一次性執行與保守結果；必要 Python／Node／HTTP／瀏覽器回歸及 repo gates。完整MVP／Cursor真實新入口狀態不變。

基準 `fallrising/newclear@b9109be632046d1da7c98db12c77214a11bdbc4e`；產品元件與 T30 結案來源一致。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0031-01 | Cursor 授權交接修正；GLM 審查嘗試已記錄 | AC-01／09／11 子集 | in_progress | 2026-11-22T16:00:56.182651+00:00 | — | 2026-11-22T16:09:07.409284+00:00 |

T-0031 本機結果：主導重現已消耗 Cursor grant id 可被新程序再次帶入的授權指紋歸屬問題，加入 dispatcher 同 PID／繼承鎖／私有消耗收據與排他 runner 領取檢查；失敗不退還。單次 Pi／GLM 5.3 開發審查 HTTP401 Invalid credential，未取得審查，沒有重試／fallback；不是產品模型驗收。詳[證據](../evidence/cursor-grant-handoff-2026-11-23.json)。完整 MVP／Cursor 真實新入口仍 pending。

T31 本機驗收：236 Python／74 Node，Cursor 五組、Pi 首次五組／指定重試四組 Chrome 通過。首輪唯讀導航與 reload 競態保留，測試改為先等待目標 URL；產品 UI 未改。真實 runner 授權檢查／dispatcher／exec／檔案鎖與明示原生邊界替身；零產品模型呼叫。主導審查，PR／CI／合併待完成。
