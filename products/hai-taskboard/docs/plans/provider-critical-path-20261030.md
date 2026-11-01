# HAI 真實 provider 主線診斷與有界閉環提案

日期：2026-10-30。任務：T-1030／SC-DOC-02。
基準：`1181db123f108ab096bbc1ae9a4e804097d939ca`。狀態：**診斷與 Proposed 順序調整，尚未接受或啟動實作。**
相關：[Session 控制室設計](../sdd/session-control-room.md)、[現行計劃](remaining-work-20261029.md)、
[SUCCESS](../../SUCCESS.md)、[唯一 BOARD](../tasks/BOARD.md)。本文件不建立另一套任務狀態、不改既有 AC、不授權真實執行。

## 1. 先回答問題

**不是「大家完全沒走主線」；但原本的安全核心主線與 operator 想要的日常真實 Agent 閉環，已經被過長的階段依賴隔開。**
任務切細本身不是錯，錯誤風險是只按 API／文件的小片結案，卻沒有持續縮短「一件真工作可被派出並驗收」的距離。

以下分開 repo 事實、工程判斷與待批准方案。未取得完整工時／會話紀錄，不能聲稱多少比例時間浪費於支線，也不能把 proposed 文件全當成已開發功能。

## 2. 已核對事實與真正門檻

| 事實 | 基準來源 | 意義 |
| --- | --- | --- |
| 真 provider 被明文禁止，不只是 TODO 漏接 | [AGENTS](../../AGENTS.md) 開頭與第 7 條；[SDD](../SDD.md) HAI-BOUNDARY-002 | 執行 agent 在現行 P0-A 授權內不能自行接上真 provider |
| 最初的第一證明是可接續與安全完成，不是日常 CLI 管理 | SDD §1、HAI-GOAL-004 | fake-first 有合理安全目的，但不等於已證明 provider 整合 |
| 完整 P0-A 仍未完成 | SUCCESS AC-02/03/04 pending、mainline incomplete、usable_tag none | 依現行順序，真實整合自然一直排不到 |
| 近期並非只有外觀支線 | BOARD：M0／PR #798；M1a／PR #812；M1b／PR #824 | M1a 補 completion snapshot API，M1b 補受 scope/digest 保護的產物讀取，都是可用閉環必要部件 |
| 最新下一片是 M1c 人工報告持久化／提交 | BOARD 的 M1b delivery 結尾 | 不可誤報 M1b 還沒做，也不以本輪文件重新開一遍 M0 |
| 現行計劃主圖是 M8 → policy/context → MCP → LIVE | 現行計劃 §2 | 容易被讀成必須先完成一整套通道平台 |
| 但正文允許之後核准的直接 adapter 路線 | 現行計劃 §5 U2-LIVE 及其後文字 | MCP 不是技術上不可替代的必需；圖文應在順序修訂時一致 |
| Kanzo 便利功能、Decision 擴充等仍為 Proposed | 現行計劃 §5 | U1 並非每一項都必須先做完；不能誤稱便利功能已搶占全部實作 |

保留歷史記錄的時間與來源；本輪只做靜態核對，沒有重跑那些 PR 的歷史 runtime acceptance。

## 3. 診斷：哪些是合理工作，哪些會拖慢出口

**合理且不能刪的核心：** command/idempotency、權限與 workspace confinement、真產物保存、exact-subject evidence、
人工 Done、lookup/cancel 的不確定結果、restore fencing。拿真 CLI exit 0 代替它們，不是加速而是換成不可信的完成。

**結構性問題（工程判斷）：**

- 產品的可感知終點是「真實工作閉環」，排程的里程碑卻偏向「更多底層 API 被獨立驗收」；兩者沒有固定的垂直切片出口。
- 把完整產品的所有 surface／一般化恢復與擴充契約都放在首 provider 風險探索之前，會延後才發現原生 session、登入、usage、cancel／resume 的實際差異。
- 現行計劃要求每個 bounded milestone 分別接受契約／啟動，能保護範圍，但若連內部 API 小步都要求 owner 重複授權，會增加往返；不應用微小結案數代替使用者價值。
- 再加入完整擬人世界、第二 provider、跨機 Registry 或通用 Adapter SDK 作為前置，只會重演這個問題。

因此，不能簡化成「支線太多，停止測試就好」。應保留安全不變量，縮窄首個真實切片的環境、功能與權限，
並把方便性／動畫移出 critical path。上述是由依賴結構作出的判斷，不是已量測的工時因果分析。

## 4. 現行路線與建議路線必須分開

### A. 現行授權（仍有效）

繼續 BOARD 的 M1c，再按 M2..M8 完成完整 Fake-only P0-A；之後另行 G2 授權一個真實 adapter。
U1／D1／D2 不應自動插到其前面。MCP 走所選 transport 路線，不把圖上先後擅自當成不可繞過的技術約束。
本輪文件不啟動 M1c，也不讓已接受的 P0-A 行為變成可執行真 agent。

### B. 建議調整（待一次明確的有界授權）

把下一個使用者可感知里程碑訂為 **L1：單 provider、單 project、單 runner 的真實交付閉環**。
它沿用 HAI 的 Run/outbox/artifact/evidence，不另開無法接回產品的 demo。
原定完整 P0-A 的全部 AC 仍保留；L1 只是單獨標識的受控技術驗證，不改稱 P0-A complete 或 usable。

```text
既有 M1a/M1b（已交付，不重做）
  → M1c／M2 中閉環需要的報告與政策邊界
  → L1 安全前置實證 + 一次有界 G2/pilot 授權與規格修訂
  → 一個 direct adapter + Session 卡／drawer
  → 真產物 → Candidate → independent evidence → operator completion
  → response-loss／cancel uncertainty／restart／restore fencing 驗證
  → L1 有界驗收；完整 P0-A 尚缺項繼續留在原 BOARD
```

這不是無條件跳過 M8：在現行 HAI-GOAL-004／AGENTS 禁止仍有效時，L1 不可開工。
採用 B 必須先批准下面的精確變更集合，而不是讓 worker 用 feature flag 偷渡真 provider。
若沒有批准，A 與 M1c 下一步保持不變。

### 採用 B 需一次定案的變更集合

| 權威位置 | 待批准的精確差異 | 不能改掉的部分 |
| --- | --- | --- |
| AGENTS 開頭／第 7 條 | 額外允許明列的一個 bounded L1 profile；P0-A runtime 預設仍只用 fake/v1 | 不授權任意 provider／shell／network／自動批准 |
| SDD HAI-GOAL-004 與 P0-B／G2 關係 | 容許通過 L1 安全子集後提早做單 provider 受控驗證，與完整產品完成分開 | outbox、epoch/generation fencing、Unknown、安全／Done predicates |
| SUCCESS 現況／未來路線 | 增列 L1 的獨立 scope/AC/evidence；明示不提升 AC-02..04 或 usable_tag | 原 P0-A 承諾與歷史 FAIL/NotRun |
| remaining-work §2／§5 | 直接 adapter 與 MCP 為選路；U1/D/動畫不是 L1 前置 | 完整 P0-A 剩餘工作仍需交付 |
| BOARD／assignment | 一個 L1 outcome milestone，內部工作可在已批准範圍內連續執行與審查 | 不新增第二狀態板、不跳過認領／review／驗收 |

Provider 預設候選沿原 P0-B 的 Codex 方向，但實際版本、帳號登入方式、workspace、network allowlist、
最大 active Run 數、硬性 wall-time／model-call／費用上限與人工停止方式都須在該有界授權明列。
任何預算或 scope 未定義時不啟動。已有訂閱也不代表自動授權這次真實消耗。
這些是 L1 同一個契約的前置欄位，不再拆成無限次「再做一份規劃」的獨立專案。

## 5. L1 必須具備與不必等待的項目

| 首真實閉環前必須有證據 | 可排在首閉環後／不同切片 |
| --- | --- |
| exact accepted input、明確 project/workspace、單一受管 Session 綁定 | 全部既有外部 Session 自動發現 |
| scoped principal、credential confinement、外部動作 allowlist、可執行的硬上限 | 多 provider／帳號聚合、訂閱餘額儀表 |
| idempotent command/outbox、start ACK、query/lookup、cancel uncertainty、fence | MCP transport、Slack/Lark、排程／Webhook |
| 真產物 seal/read、獨立 review/evidence、人工 Done 的最小完整流程 | 便利搜尋／快速輸入／完整資料匯出 |
| response-loss、重啟與 restore generation 的安全驗證；未知副作用不自動重跑 | 任意工作圖 activation／通用 ContextPack UX 的全部完整產品驗收仍在原 P0-A scope，不佯稱已通過 |
| 基本 Session 卡／drawer、來源可信度、時間／機器／回合／Context／最後用量（未知可見） | 像素辦公室、尋路、角色社交、Prism 儀表整合 |

安全前置不能只拿 Fake PASS 冒充原生能力。Provider 不支援精確 cancellation／usage 時要降級或拒絕，
原生結果不可確認則保持 Unknown；不能為了「第一個真實 Demo」降低停止／完成門檻。

## 6. L1 出口與控制細碎化

未來驗收（**Proposed/NotRun**）必須包括：一件真實修改由 UI 明確派出、顯示正確 Session／runner、
產物可讀且綁定 exact subject、獨立 evidence 可追溯、operator 完成；重送不重複啟動、失聯不畫成功、
取消未確認不標停止、restore 後舊 generation 不改新狀態。對應 HAI-SC-T01..10 的適用子集與原有 gate。

派工 adapter、最小 Session drawer、產物與驗收要屬於同一 outcome milestone；內部可以小 PR，
但每片都要說明解掉哪個 L1 blocker，不能只用 PR 數／文件數追蹤進度。
新發現若不是 L1 安全或閉環必需，登記後延後，不自動擴張首片。Provider protocol／權限未知之處採短小且有上限的能力驗證；
不能把所有未知都推到最後，也不能為調研啟動未授權的真實呼叫。

## 7. 本輪交付與接手入口

本輪只交付 Session 設計、此診斷與可回讀的文件證據。A 仍是執行權威，B 是建議，沒有真實 provider 被啟用。
接手先讀 BOARD 最新 delivery，避免把計劃中的歷史「M0 尚待開始」「M1b 未開始」當成現況。
本輪唯一需要 owner 裁定的後續方向是是否採用 B 的 **單 provider 有界 L1 里程碑與上述精確授權修訂**；
不是再批准一堆互不相連的研究或動畫支線。具體上限未定案仍停止，不能把方向同意當成無限額執行權。
