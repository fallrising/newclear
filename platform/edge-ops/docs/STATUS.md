# Edge Ops — STATUS

日期：2026-09-28。本檔是本專案唯一進度權威。

## 已接受設計與本次授權

SDD PR #161 已合併，merge `05809fc951ef929665e798846aba348d6c9071a5`。Owner 隨後要求先開發前後端骨架，使用 mock 跑通資料鏈路。本次交付 S0 local monitoring slice，詳見 [S0 scope](S0-MOCK-CHAIN.md)。不等於完整 M0/M1 驗收；沒有任何 host/deploy 授權。

| 項目 | 狀態 | 證據／邊界 |
| --- | --- | --- |
| Common telemetry types/schema/fixture + 8 operations | implemented / local checked | demo schema，不含完整 production response codegen |
| Worker handler + SQLite test adapter + HTTP mock Agent | implemented / local passed | 21 tests passed、0 failed、0 skipped |
| Backend typecheck | local passed | Node22.16 / global TS5.8.3；locked compiler另由CI驗證 |
| React UI / Vite build / 5 browser tests | implemented / CI pending | local npm DNS blocked；尚不宣稱browser驗收通過 |
| Local workerd + D1 smoke | implemented / CI pending | 不以SQLite adapter測試代替此證據 |
| Root path-scoped CI | added | contents:read、固定actions、无deploy／secrets |
| Independent review / owner product acceptance | pending | 作者自查不等於獨立review |
| Actual Go collector / real identity / DO / logs / jobs / bootstrap | not implemented | 原M0–M6安全gate仍保留 |
| Cloudflare deployment / target-host tests | not run | 本次無部署或真實主機操作 |

基底固定 `05809fc951ef929665e798846aba348d6c9071a5`；本地執行證據見 [S0-LOCAL](evidence/S0-LOCAL.md)。遠端驗收以此交付PR的exact-head checks為準；後續更新本檔不得把pending自動寫成passed。

## 下一步

先處理S0的CI或使用者驗收問題；完成後再補M0生產契約、Go/TS簽章、真實註冊及Job CAS驗證。S0不部署、不合併其他PR、不安裝現役主機Agent；新的實作PR未經owner要求不自動merge。
