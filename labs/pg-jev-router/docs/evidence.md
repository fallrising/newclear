# Verification record

日期：2026-10-04。Upstream source：`8d9598d87d5ff460998d91ec070226176024a841`，extension 0.2.1。Newclear 初始 base：`37681e68aa76b153bf781b687ec96ff36f47cbdf`。

## 編輯環境已執行

- `make -C labs/pg-jev-router check`：15 unittest 通過（含九案 subtests、輸入上限、機率/分布、error、loopback HTTP contract），bash syntax 通過。
- `make -C labs/pg-jev-router demo`：九案回 action/route，全部明示 deterministic-fixture／extension=false／dispatch=false。
- Docker／PostgreSQL executable 不存在；apt 安裝前置因 sandbox setgroups/seteuid 不可用而停止，未改變權限或連 production 主機。本機 container gate skipped。

## 真 extension 證據入口

[pg-jev router lab CI](https://github.com/fallrising/newclear/actions/workflows/pg-jev-router-ci.yml) 的 `contracts-and-extension` job 會執行 `make integration`。查看本次 PR 的確切 head／run，不以其他 branch 綠燈推論這次完成。CI logs 包括 PostgreSQL 初始化、extension version assertion、六項 integration tests、cache/batch 數字及九案結果。

此文件在首次提交時尚無 hosted 結果；交付的 PR 說明與任務驗收報告記錄確切 run URL、commit SHA 及結論。沒有宣稱本機跑過 Docker。

## 未驗證

- 真 TypeSafe Jev、stuntd/Laya 或其他模型；沒有下載模型權重或使用 API key。
- 中文語意品質、prompt-injection 防禦效果、校準、真實成本／延遲、負載。
- 平台 runtime、production database、tenant/RLS isolation、live profile switching。

合成測試通過只代表 contract／policy／pg-jev 接線符合本 lab；不得引用為模型準確率。
