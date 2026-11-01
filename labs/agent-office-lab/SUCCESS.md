---

project: labs/agent-office-lab
purpose: 驗證本地優先的 OpenCode、Grok、Pi、Cursor 四工位 Agent Office
kind: lab
mainline: incomplete
usable_tag: none
reviewed: 2026-11-01
source_commit: 211da65fffe195dc795656e31a785eceb885d9f4
---

# Agent Office Lab 驗收

四個 provider 的合成任務已實測通過：OpenCode、Grok、Pi + DeepSeek、Cursor。各次獨立付費授權已使用，沒有自動重跑；歷史失敗及修正見 [HANDOFF](HANDOFF.md) 和 [任務板](docs/tasks/BOARD.md)。完整 MVP 保持 incomplete。

## 主線與範圍

T-0012：統一四 provider 的 detect／plan／run CLI，預設不執行任務；遠端執行須同時明示 execute 與 allow-remote。共用持續到清理完成的執行鎖，直接 runner 也納入；異常退出留下未確認紀錄，禁止自動重跑。只支援既有合成任務與預設限額，沒有任意 shell、prompt、模型 fallback 或自動排程。

驗證計畫：四 CLI 在 OS 拒絕網路下檢查真實版本／help；離線測試授權 gate、固定 argv、互斥、exec 繼承、異常中斷與清理紀錄。驗證不發新模型請求、不啟動 Strata，完整派工到模型結果與跨 provider 生命週期保留待驗。

依 [SDD](docs/SDD.md) 完成單專案、單執行佇列、四 provider 的本機 Office。原 AC 條件不縮減；AC-10 是獨立研究，AC-12 是公開匯入，AC-13 是 owner 要求的 Cursor 擴充。

T-0011：整合四 provider 的唯讀結果入口，列出來源、模型、任務狀態與合成產物；重新核對檔案內容及原紀錄 hash，產生可離線開啟的互動 HTML。只讀明確選擇的 runs 根目錄，不讀取登入檔、不執行 agent、不新增模型呼叫。拒絕符號連結、路徑逃逸、超大／損壞報告；啟動檢查、失敗、未完成及驗證不足不能顯示成功。輸出採白名單，不含原始日誌、session、私人路徑或憑證。

驗證計畫：離線回歸涵蓋四種 schema、錯誤分類、篡改／連結／輸出注入；以既有四 provider 真實 run 回讀產物，再測瀏覽器篩選及詳細結果、無外部請求。這是 AC-09 結果入口與 AC-11 讀取邊界子集；統一派工、原生終端互動及完整生命週期仍待完成，不以結果頁標記完整 AC 通過。

不包含部署、發布套件、模型權重、私人專案或雲端自動 fallback。`source_commit` 為本輪基準。

## 驗收條件

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 四種 CLI，When detect，Then 正確識別版本／能力，缺失或不相容不啟動。 | pending | [Grok／Pi 固定套件與實際 version/help 已通過](docs/evidence/remote-preflight-2026-11-01.json)；[統一 CLI 偵測與 launch gate](docs/DISPATCH.md) 及四 CLI 真實斷網預檢通過；新入口的模型任務尚待驗收。 |
| AC-02 | Given fixture workspace，When OpenCode 執行指定任務，Then 原生事件、session 與檔案 hash 證明成功。 | passed | [本輪實測](docs/evidence/lifecycle.md) 再驗證原生檔案任務；[原歷史摘要](docs/evidence/2026-10-31.json) 保留。 |
| AC-03 | Given 確認版 Grok，When 執行同等任務，Then CLI 身分、session 與產物可核對。 | passed | [Grok 原生真實任務](docs/evidence/grok-completed-2026-11-01.json)：同 session／模型、兩讀一改、end_turn、產物 hash 與清理通過。 |
| AC-04 | Given Pi + DeepSeek，When 執行同等任務，Then provider/model、settled 事件及檔案正確。 | passed | [Pi 原生工位實測](docs/evidence/pi-live-2026-11-01.json)：3 次 DeepSeek 請求、agent_settled、同 session/model、read/write、產物 hash 及清理通過。 |
| AC-05 | Given 原生權限或使用者問題，When 等待與回覆，Then waiting_input 後繼續。 | pending | [OpenCode edit 權限子集通過](docs/evidence/lifecycle.md)；Grok／Pi／Cursor 與其他互動待驗。 |
| AC-06 | Given 執行中任務，When 取消，Then 10 秒 grace 後所屬程序全部退出。 | pending | [OpenCode 歷史子集](docs/evidence/2026-10-31.json) 通過，Grok／Pi／Cursor 待驗。 |
| AC-07 | Given crash／401／429，When 失敗，Then 不顯示成功且最多兩次顯式重試。 | pending | 尚缺故障驗收。 |
| AC-08 | Given browser refresh 或 host 重啟，When 恢復，Then 不重跑、unfinished 標 interrupted。 | pending | [OpenCode 新程序／同 session 與瀏覽器刷新通過](docs/evidence/lifecycle.md)；[host restart 與手動恢復通過](docs/evidence/restart.md)；Grok／Pi／Cursor 待驗。 |
| AC-09 | Given 四 provider 真實 run，When 開啟結果，Then 產物、模型與來源可分辨。 | pending | [唯讀結果入口](docs/RESULTS.md) 已回讀四 provider 真實產物；尚缺派工到結果的四工位整合流程。 |
| AC-10 | Given 本地 Strata，When 執行公開 GitHub tool loop，Then 真實 tool_call、API 結果與後續回答完成。 | pending | 獨立研究未通過，非 MVP 阻塞。 |
| AC-11 | Given 路徑逃逸、偽造 hook 或金鑰輸出，When 操作，Then 阻擋或遮蔽。 | pending | [OpenCode sandbox probe](docs/evidence/2026-10-31.json) 僅驗證網路／寫入子集；[結果入口讀取／顯示邊界](docs/evidence/results-console-2026-11-01.json) 通過，完整邊界仍待驗。 |
| AC-12 | Given 公開匯入來源，When 執行 publication、policy 與 repo gates，Then 無 runtime 私人資料、導航正確且檢查通過。 | passed | [匯入驗證](docs/evidence/publication.md)；CI／交付另見任務板。 |
| AC-13 | Given 官方 Cursor Agent 與明確登入，When 執行同等合成任務，Then 原生 session、模型來源、完成事件與產物 hash 可核對。 | passed | [Cursor 真實任務](docs/evidence/cursor-completed-2026-11-01.json)：同 session／模型、三次工具、completed stop、用量、產物 hash 與清理全部通過。 |

本輪結果：T-0011：新增[統一結果入口](docs/RESULTS.md)，以白名單回讀四 provider 原生紀錄、重新核對合成產物內容與 SHA-256，提供離線篩選與詳細頁。96 項離線測試通過，既有 33 筆 run 回讀保留成功／失敗／啟動檢查／未完成區別，四 provider 各有成功產物通過重驗；Chrome 篩選、詳細內容、刷新通過，零外部請求。沒有新增模型呼叫或重啟 Strata。[本輪證據](docs/evidence/results-console-2026-11-01.json)。完整 AC-09／AC-11 保持 pending；下一步仍是統一偵測／派工與跨 provider 生命週期。交付狀態見[任務板](docs/tasks/BOARD.md)。

T-0012：新增[統一偵測與派工入口](docs/DISPATCH.md)。四個固定 CLI 的實際斷網版本／help 檢查通過；run 預設只顯示計畫，遠端執行須明示 execute 與 allow-remote。四個直接 runner 共用執行鎖，跨 exec 保留，清理未確認或強制中斷會阻擋下一次派工；不自動重試。117 項離線測試通過。本輪沒有新模型呼叫或啟動 Strata，完整派工到產物與跨 provider 生命週期尚未重驗。[證據](docs/evidence/dispatch-2026-11-01.json)，交付狀態見[任務板](docs/tasks/BOARD.md)。

## 現況與缺口

四種原生 runner 各有原受測版本的真實成功證據；本輪提供統一 CLI，預設 plan，模型任務尚未從新入口重驗。AC-01 的統一偵測／派工、AC-05–AC-08 的跨 provider 權限／取消／錯誤／恢復、AC-09 完整四工位流程仍待驗。OpenCode 的生命週期與 host 重啟子集已通過，不能代替其他 provider。

OpenCode sandbox 仍允許區外讀取；Office／Strata 整棵程序樹尚未做 egress audit。維持 `strict_network_isolation_verified=false`，僅使用合成資料。614 個上游測試不能代替四 provider 整合。

## 啟動與驗證

[安裝與重跑](docs/SETUP.md)、[README](README.md)、[公開證據說明](docs/evidence/README.md)。
元件檢查：`python3 scripts/check_publication.py`、`node --test scripts/local_office_policy.test.mjs`。
Repo 檢查：`python3 scripts/check_indexes.py`。runtime 另需 macOS arm64／Metal／本機模型；Linux CI 不測推論。

## 可用版本

`usable_tag: none`。主線未完成，沒有發布 tag 或部署。
