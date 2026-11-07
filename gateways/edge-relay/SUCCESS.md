---
project: gateways/edge-relay
purpose: 以可替換的反向通道與通知 adapters 安全連接受授權的本機服務
kind: service
mainline: incomplete
usable_tag: none
reviewed: 2026-11-02
source_commit: 244c7f7b416508aedd8f5f8d4a082ae2bb17d022
---

# Edge Relay 主線與驗收

## 主線與範圍

[SDD](SDD.md) 是設計權威；本次僅 M0 文件，runtime 尚未實作。原定可用主線包括 CF 反向通道、受限 HTTP/SSE/WS adapters、授權撤銷／有界資源、E2EE、ntfy/Bark 真機、恢復與運維；不能以合成 TLS-only demo 取代。

非目標：VPN、任意 TCP/UDP、SSH/shell、Agent 排程、任務佇列、完整遠端桌面、TURN、大檔、跨區 HA。Node relay 為後續 M4，不阻擋原定 CF 主線但不能聲稱已具備。

source_commit 表示新案建立時核對的 repo 基準，不代表該基準已有此元件或任何 runtime 證據。本次候選 commit 與驗證結果以 PR 回讀為準。

## 驗收條件

| ID | Given/When/Then | 狀態 | 證據／缺漏 |
| --- | --- | --- | --- |
| AC-001 | Given Alma 的特定拓撲，When 抽取通用架構，Then 明確區分 transport、driver、adapter、notification、非目標與既有項目 | passed | [SDD](SDD.md) §1–6、§10；文件內容，不是 runtime |
| AC-002 | Given 多端連線會斷線／越權／慢讀，When 定義契約，Then 有版本、狀態機、epoch、取消、資源預算、授權／加密 gate 與禁止重播 | passed | [protocol](docs/protocol.md)、[security](docs/security.md)；規格自查，獨立安全 review 未完成 |
| AC-003 | Given ntfy/Bark 可能不可達及受 iOS 限制，When 定義 notifier，Then 有 intent、outbox、TTL／重試／去重、隱私與不保證喚醒的邊界 | passed | [notifications](docs/notifications.md)；真機證據 pending |
| AC-004 | Given 下一位實作者無聊天上下文，When 讀取規格，Then 能定位來源／決策／里程碑／每項 runtime 驗證 | passed | [來源與決策](docs/sources-and-decisions.md)、[驗證計畫](docs/verification-plan.md) |
| AC-005 | Given 新案加入 monorepo，When 檢查候選提交，Then SUCCESS、認領、inventory、PROJECTS、README／llms 導航與必要 CI 一致 | passed | [驗證紀錄](docs/validation.md)：候選 `528a1a6` 的兩組 CI 已回讀成功；後續證據-only 提交仍須重驗 |
| AC-006 | Given 不同 NAT 網路的 client/endpoint，When 經真 CF 連接，Then 無入站 port 仍能操作且離線明確失敗 | pending | 未實作／未測；[測試矩陣](docs/verification-plan.md) |
| AC-007 | Given 真 HTTP/SSE/WS 本機服務，When 經 adapters 轉送及中止，Then status、bytes、事件時序與 message boundary 正確且資源釋放 | pending | 未實作／未測；[測試矩陣](docs/verification-plan.md) |
| AC-008 | Given 多租戶、過期／撤銷 grant 及洩漏 route，When OPEN 或 DO 重建，Then 無跨租戶／未授權存取或撤銷復活 | pending | 未實作／未測；[安全契約](docs/security.md) |
| AC-009 | Given 32 streams 與慢 consumer／超額 frame，When 壓力及超時發生，Then buffer 有界、其他 streams 可前進且超量拒絕 | pending | 未實作／未測；[P-06](docs/protocol.md) |
| AC-010 | Given mutation 已提交但回覆遺失，When connector 重連，Then 不自動重播並 fencing 舊 epoch、明示 UNKNOWN_OUTCOME | pending | 未實作／未測；[測試矩陣](docs/verification-plan.md) |
| AC-011 | Given 已配對端點及惡意 relay，When 換 key／重播／明文降級，Then 不可解密或引發未授權副作用且 browser 信任假設通過獨立 review | pending | D-01/D-04 未關閉；無 crypto 實作／安全 review |
| AC-012 | Given 真 ntfy/Bark 與 iOS 手機，When 鎖屏／重試／到期／點擊通知，Then provider 與 displayed 證據分列、詳情需重授權、通知不阻塞通道 | pending | 未部署 provider／未真機測試 |
| AC-013 | Given 真 CF 閒置與活動 sessions，When hibernation／deploy／restart，Then routing 可重建或明確失敗且沒有舊權限復活 | pending | 未部署 CF；不得以 emulator 取代 |
| AC-014 | Given 乾淨環境與受限預算，When 按 runbook 啟停／撤銷／復原，Then 操作可重現、用量可觀察且未允許服務仍關閉 | pending | runtime/runbook 待實作與實測；[驗證計畫](docs/verification-plan.md) |

## 現況與缺口

本案是 SDD-only。AC-001–004 的 passed 僅表示文件條款已寫入並自查；不是獨立審查或產品驗收。AC-005 已有候選 SHA 的 CI／回讀證據，詳見 [驗證紀錄](docs/validation.md)。AC-006–014 全部未執行；沒有 Worker、SDK、connector、schema codec 或 notification adapter 實作。

關鍵缺口：D-01 加密 library/profile、D-02 真 CF buffer/restoration、D-03 推播版本／真機、D-04 browser bootstrap。里程碑／task 狀態以 [任務板](docs/tasks/BOARD.md) 與 PR 為準。

## 啟動與驗證

沒有產品啟動命令。文件驗證：從 repo 根執行 `python3 scripts/check_project_success.py --projects gateways/edge-relay` 與 `python3 scripts/check_indexes.py`；完整要求見 [verification-plan](docs/verification-plan.md)。

此處列的是驗證入口，不宣稱已在完整 checkout 跑過。無法執行時要記原因及實際補證，不降低規則。

## 可用版本

`none`。沒有發布、部署或全項目 usable tag。完成且合併 M0 也不使主線 complete；AC-006–014 及必要 CI／獨立審查全部完成、合併後，仍須 owner 授權 release。
