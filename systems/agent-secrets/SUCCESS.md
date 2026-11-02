---
project: systems/agent-secrets
purpose: 提供可稽核的加密秘密儲存與 Agent 受控憑證使用
kind: service
mainline: incomplete
usable_tag: none
reviewed: 2026-11-02
source_commit: 244c7f7b416508aedd8f5f8d4a082ae2bb17d022
---

# Agent Secrets 驗收契約

## 主線與範圍

產品主線為加密秘密 Store 及有界 Credential Broker；尚無 runtime。本輪只交付 [SDD](docs/SDD.md) 文件里程碑 T-0959，Agent 擴充為 Proposed，未授權開發或部署。來源 SHA 是建立本專案時的 newclear 基準，不是已驗收產品版本。

不含硬體 HSM、完整 KMS、零知識、P0、任意 shell／URL 代理、多租戶或 production-ready 承諾。原版 API 會在 Worker 處理明文。

## 驗收條件

ID 與 [SDD §12](docs/SDD.md#12-驗收與可追溯性) 一致。passed 只指該文件條件，不代表 runtime 通過。

| ID | Given/When/Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-001 | Given 固定上游 SHA；When 對照來源；Then 模組、HTTP、密文及安全差異可追溯且不混稱實作 | passed | [來源](docs/SOURCES.md)、[SDD](docs/SDD.md) 靜態檢視 |
| AC-002 | Given 本輪 docs-only；When 接手閱讀；Then 範圍、資料流、介面、錯誤、恢復及非目標明確 | passed | [SDD](docs/SDD.md) §1–12 |
| AC-003 | Given Agent 憑證使用構想；When 檢視設計；Then 模型不作授權權威且 raw export 非預設，擴充標 Proposed | passed | [ADR](docs/ADR.md)、SDD §7–10；runtime 未實作 |
| AC-004 | Given 新專案；When 從索引進入；Then inventory、PROJECTS、README、SUCCESS、AGENTS、任務板可導航且標 spec-only | pending | 本機與 PR checkout 檢查結果見 [交接](docs/HANDOFF.md) |
| AC-005 | Given 文件候選 commit；When 交付 Draft PR；Then 實際檢查與未跑項、head 回讀、無 merge／deploy 均有紀錄 | pending | 等實際 PR／CI／回讀；見 [交接](docs/HANDOFF.md) |
| AC-101 | Given 合成 value／Part A／B；When PUT／GET／overwrite／DELETE；Then 成功與 400／403／404、8192 邊界、Unicode 符合批准契約 | pending | M1 未授權、未實作、未跑 |
| AC-102 | Given 正確 envelope；When 換 A／B／AAD、改密文或未知 v；Then 拒絕解密且不回傳秘密 | pending | M1 crypto／兼容測試未跑 |
| AC-103 | Given 固定 MCP 版本與真宿主；When initialize／list／call／分段輸入；Then framing 相容、stdout 只有協定資料、Agent 不見 raw 工具 | pending | MCP 未實作、真宿主未跑 |
| AC-104 | Given 無權或被 prompt injection 操控的 Agent；When 偽造身份／核准、換 target／args、要求 raw secret；Then deny 且不發下游請求 | pending | M2 未授權、未實作 |
| AC-105 | Given 單次 grant；When 併發、過期、撤銷、重啟／斷線與舊 KV 讀取；Then 至多一次權威消耗、撤銷邊界生效、UNKNOWN 不盲重試 | pending | 權威儲存與故障測試待定 |
| AC-106 | Given 合成秘密與允許動作；When 檢查模型結果、錯誤、日誌、trace、檔案與程序邊界；Then 無原始憑證且輸出符合 allowlist | pending | 對抗／隔離測試與獨立安全審查未跑 |
| AC-107 | Given 備份與舊版本測試資料；When 還原、輪替、失去金鑰或控制儲存；Then 可核對還原或明確 fail closed，不假稱可復原 | pending | 無部署、無輪替／還原演練 |

## 現況與缺口

只有文件；無原始碼、依賴安裝、已部署 API、可呼叫 MCP、真憑證與可用 tag。Agent 授權／審批／grant／audit 不是上游現成功能。

開發前須定案 [ADR](docs/ADR.md) 的授權、身份、控制儲存、第一個 connector、隔離與版本遷移；不能用普通 CI 取代安全審查。任務仍在 [BOARD](docs/tasks/BOARD.md) 認領中。

## 啟動與驗證

目前沒有啟動命令。於完整 repository checkout 執行：

```sh
python3 scripts/check_project_success.py --projects systems/agent-secrets
python3 scripts/check_project_success.py --write-index
python3 scripts/check_indexes.py
```

上述只檢查文件／導航，不驗證加密或 Agent 安全。實際已跑、受阻與未跑項以 [HANDOFF](docs/HANDOFF.md) 及 PR checks 為準。

## 可用版本

`usable_tag: none`。不得建立 usable tag 或以文件完成宣稱服務可用；後續各 runtime AC、必要 CI／獨立審查與合併等條件都未滿足。本輪沒有 merge、release 或 deploy 授權。
