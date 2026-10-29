---
project: labs/graphify-lab
purpose: 實跑 Graphify 開發場景並驗證固定參考程式碼與索引的單份共用
kind: lab
mainline: complete
usable_tag: none
reviewed: 2026-10-29
source_commit: 011fa8cac6137735b576e14b5695ea26544e91db
---

# Graphify lab 成功契約

## 主線與範圍

依 [SDD](SDD.md) 實跑真正的 Graphify 0.9.97，驗證本機 code-only、公開固定 source、共用 source/index 與 stdio MCP。
不包含部署、付費模型、取代原始碼、任意服務跨 repo 語義推理或完整靜態分析保證。

## 驗收條件

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 固定 upstream／套件，When 安裝並讀回，Then 版本與來源可追溯。 | passed | [來源與版本](docs/upstream.md)、[REF-01](docs/evidence/full-run.json)：SHA／hash lock／六個核心檔比較成功。 |
| AC-02 | Given 已知 source，When 導覽、定位及追蹤，Then 真 graph 命中 symbol／行號／路徑且負例有效。 | passed | [DEV-01](docs/evidence/full-run.json)：真 Python AST、query／explain／有向 calls、原生 HTML 與無命中／反向負例。 |
| AC-03 | Given 真實 newclear 元件與公開 reference，When 建圖查詢，Then 得到非空圖及可核對來源。 | passed | [REF-01／REPO-01](docs/evidence/full-run.json)：Graphify 3,925 nodes／8,915 edges；codex-usage 222／550；兩個真實定義行回讀。 |
| AC-04 | Given 已知 caller／test，When 查修改影響，Then 結果包含預期依賴並標明限制。 | passed | [DEV-02](docs/evidence/full-run.json)：caller、入口及測試 call site 正確，無關函式排除；不代表完整 test selector。 |
| AC-05 | Given 修改及髒快取，When 更新或重用，Then 新舊符號與失效狀態正確。 | passed | [DEV-04](docs/evidence/full-run.json) 與 [29 項邊界測試](docs/evidence/unit-tests.txt)：rename／刪除、dirty／corrupt／ancestor config／Git context 變更。 |
| AC-06 | Given 兩個獨立圖，When 合併，Then namespace／provenance 保留且正負例可區分。 | passed | [DEV-05](docs/evidence/full-run.json)：真 TypeScript 跨 repo member call、同名型別歧義拒絕、無關 method 排除。 |
| AC-07 | Given 兩個 consumer，When 取同 revision，Then 共用相同來源與索引並保護並行／損壞。 | passed | [REF-01](docs/evidence/full-run.json) 的相同 inode／一份 source；真三程序 cache tests 各只一個 cold writer。 |
| AC-08 | Given 冷暖執行，When 量測，Then 證據記錄 bytes／時間與計算假設。 | passed | [效能／空間證據](docs/evidence/README.md)：實測與 1／2／5／10 consumer 推算分開；source-only baseline、環境成本與不同 query 語意保留。 |
| AC-09 | Given 真 stdio MCP 與完整變更，When 執行 gates，Then handshake／查詢、整合測試、索引及獨立審查通過。 | passed | [DEV-03／CI](docs/evidence/README.md)、[獨立 ACCEPT](docs/evidence/review.md)：兩個真 MCP session、29 tests、4 項 CI success。 |

## 現況與缺口

本次有界實驗已取得全部九項 AC 的 runtime 證據；[完整報告](docs/evidence/full-run.json) 7 passed／0 failed。
程式與來源 hash 已核對，獨立審查唯一 P2 已修正，沒有未解 must-fix。

第一輪有界實驗的 `mainline: complete` 對應以上 AC-01～09。
[PR #759](https://github.com/fallrising/newclear/pull/759) 已於 2026-10-29T14:14:07Z 合併（`f799a8f8a816dee05f67aa503100cd229d6e8ad1`），
[結案 PR #760](https://github.com/fallrising/newclear/pull/760) 已於 14:17:46Z 合併（`ef690ab47cc413852b1639e4600138dfff0ea498`）。
本次文件收尾沿用 2026-10-29 的既有 runtime 證據，沒有冒稱重跑；runtime、fixtures、lock 未變。
沒有宣稱 token 節省、所有語言／動態呼叫完整性、HTML 真瀏覽器互動、遠端多機共享或 production 部署。
詳見 [限制與失敗紀錄](docs/evidence/README.md)；不把這些未驗範圍標為成功。

## 啟動與驗證

[README](README.md) 提供 `make setup`／`make prepare`／`make check`／`make full`，及 query／explain／source／serve 的日常入口。
預設 cache 跨 checkout 共用；run 不覆寫舊證據。元件 CI 會從乾淨 runner 安裝鎖定依賴並跑真場景。
Repo gate：`python3 scripts/check_indexes.py`、根目錄 workflow static validation；認領與交付狀態見 [任務板](docs/tasks/BOARD.md)。

## 可用版本

`usable_tag: none`。原 Draft 限制是初次交付的歷史狀態，其後 owner 已批准正常合併。
原實驗完成與版本發布分開；未獲 tag／release／deploy 授權，沒有建立可用標記或部署。

## 後續里程碑

Owner 2026-10-29 授權 [T-0437 文件收尾與開發任務試點](docs/milestones/development-pilot.md)，
其 P-01～P-05 獨立追蹤；未完成的後續試點不回溯否定第一輪有界實驗，也不提前計為通過。

M2 本機結果：[開發任務試點證據](docs/evidence/development-pilot/README.md)。P-01～P-04 已取得實測與回歸證據；P-05 的遠端 CI／合併仍以任務板與 PR 為準。第一輪 AC 證據保留原版本。
