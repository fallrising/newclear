# Verification record

日期：2026-10-04。Upstream source：`8d9598d87d5ff460998d91ec070226176024a841`，extension 0.2.1。Newclear 初始 base：`37681e68aa76b153bf781b687ec96ff36f47cbdf`。

## 編輯環境已執行

- `make -C labs/pg-jev-router check`：15 unittest 通過（含九案 subtests、輸入上限、機率/分布、error、loopback HTTP contract），bash syntax 通過。
- `make -C labs/pg-jev-router demo`：九案回 action/route，全部明示 deterministic-fixture／extension=false／dispatch=false。
- Docker／PostgreSQL executable 不存在；apt 安裝前置因 sandbox setgroups/seteuid 不可用而停止，未改變權限或連 production 主機。本機 container gate skipped。

## 真 extension 已通過（GitHub Actions）

[pg-jev router lab CI](https://github.com/fallrising/newclear/actions/workflows/pg-jev-router-ci.yml) 的 `contracts-and-extension` job 會執行 `make integration`。查看本次 PR 的確切 head／run，不以其他 branch 綠燈推論這次完成。CI logs 包括 PostgreSQL 初始化、extension version assertion、六項 integration tests、cache/batch 數字及九案結果。

2026-10-04 已核對 [run 37189529551](https://github.com/fallrising/newclear/actions/runs/37189529551) 與 job 111398630252，結論 **success**；source head `0b1e44ac2e37577259be63b50332abcd1697cc97`，PR #261。

- Docker 真正建置與執行 PostgreSQL 16 / PLPython / pg-jev 0.2.1，沒有外部模型網路。
- 15 unit tests 與 6 integration tests 全通過；九案真 extension demo 符合預期。
- `BATCH {"rows": 9, "requests": 1}`：九列共一次 fixture API 請求。
- `CACHE {"requests_before": 1, "requests_after": 1, "cache_hits": 1}`：同 session 第二次命中快取。
- HTTP 422、缺 answer、非法機率與 timeout 均回 review；SQL literal 未修改 sentinel；非 superuser client 驗證通過。

這是 hosted container 的實際證據；本機 Docker 仍 skipped。數字只描述合成 provider 的請求／快取行為，不推導真模型 latency 或成本。

## 未驗證

- 真 TypeSafe Jev、stuntd/Laya 或其他模型；沒有下載模型權重或使用 API key。
- 中文語意品質、prompt-injection 防禦效果、校準、真實成本／延遲、負載。
- 平台 runtime、production database、tenant/RLS isolation、live profile switching。

合成測試通過只代表 contract／policy／pg-jev 接線符合本 lab；不得引用為模型準確率。
