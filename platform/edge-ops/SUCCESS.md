---
project: platform/edge-ops
purpose: 以非特權代理收集主機狀態並提供受控運維流程
kind: service
mainline: incomplete
usable_tag: none
reviewed: 2026-10-21
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# Edge Ops 成功契約

## 主線與範圍

[SDD](SDD.md)首條主線是安裝非 root Agent、安全註冊、指標持久化、面板可見、斷線標示與有限補報。
後續依 P1/P2 增加選定日誌、經批准 typed job 與初始化；目前只有 M0 契約和 S0 本機 mock。

預設 monitor-only，不提供通用 WebSSH、任意 shell、Docker socket 或遠端升權。
既有主機保留單一 host authority；不接管 Fleet workload lifecycle 或 Agent Platform 的 LLM 執行。

本契約核對的是上述來源版本中的文件與程式。
`complete` 只適用明列的主線範圍；沒有延伸為部署或生產保證。

## 驗收條件

下表 `historical` 是既有報告的結果，沒有在 2026-10-21 重跑。
`pending` 保留缺少證據或尚未實作的條件；程式存在不等於通過。

| AC ID | Given / When / Then | 狀態 | 證據或缺少原因 |
| --- | --- | --- | --- |
| AC-01 | Given 同一 strict JSON 與簽章向量，When TS 與 Go 驗證正反例，Then 拒絕非正規輸入且結果一致 | historical | [STATUS](docs/STATUS.md)：M0 34 測試及跨語言向量 |
| AC-02 | Given loopback mock Agent，When 上報、重送、離線與恢復，Then local D1/SQLite 與 React 正確呈現新鮮度及歷史 | historical | [S0 證據](docs/evidence/S0-LOCAL.md)：20 測試、workerd、5 瀏覽器流程 |
| AC-03 | Given 真實 Linux Agent，When 安全註冊並以簽署請求上報，Then nonce、撤銷、generation、有限補報與面板形成閉環 | pending | [STATUS](docs/STATUS.md)：明文 mock 身份尚未替換，真 collector/enrollment 未接線 |
| AC-04 | Given Cloudflare 執行環境與受控作業，When CAS、批准或取消遇到故障，Then D1 原子性、停止證據與獨立安全審查成立 | pending | [STATUS](docs/STATUS.md)：job CAS/rollback、BoringSSL 行為、DO/R2 與獨立 review 尚缺 |

## 現況與缺口

M0 合併不等於 owner acceptance；S0 只有 loopback demo 身份，不能部署為 live Worker。
[worker source](backend/src/worker.ts)明確要求 demo 模式與 loopback，沒有 live mode。
M0 schema 曾在 local D1 套用，不代表 job transaction 或所有 D1 行為均已驗證。
真主機、Cloudflare 遠端環境及 installer 尚未完成；不可從前端畫面推定可運維。

這次僅新增驗收入口，未改變 runtime 或原有驗收 oracle。
歷史結果若與現行 source 有相關差異，必須補驗而不能直接繼承。

## 啟動與驗證

[DEV-MOCK](docs/DEV-MOCK.md)與[Quickstart](docs/quickstart.md)列出本機 Node、SQLite/workerd 與 Web 前置條件。

已核對入口：[package scripts](package.json)與 [demo Worker](backend/src/worker.ts)。
下列是該入口既有的啟動或驗證命令，並非本次執行紀錄；
需先完成連結文件中的依賴、設定及適用環境準備。

```sh
npm run demo
npm run check
npm --prefix backend run test:workerd
npm run test:browser
```

執行後應保留來源 SHA、必要設定的非秘密摘要、命令與結果，
並將 runtime 證據逐項對回 AC；不得只用 health 或 exit 0 宣告全部完成。

## 可用版本

目前 `usable_tag: none`；本次沒有建立或發布任何 tag。
既有版本號、合併紀錄與歷史驗收不自動轉換為可用版本標記。

先完成安全身份與真唯讀 collector 的主線，取得對應環境與獨立審查證據；S0 mock 畫面不足以建立全項目 usable tag。
