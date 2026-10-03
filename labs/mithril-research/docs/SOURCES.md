# 來源與證據邊界

研究日期：2026-09-27。上游 ref `refs/heads/master` 經 GitHub connector 核對為 `9959fe2e5cd466614dc20ef7b710befaaf1d746a`。所有上游結論固定在此 commit；不以浮動 master URL 當版本證據。blob IDs 見 [upstream.lock.json](../upstream.lock.json)。

## 證據分級

**SOURCE**：指定原始碼範圍實際讀取，可支持該區段結構與邏輯的描述，不能擴張為完整安全審計。

**UPSTREAM-CLAIM**：官方文件對行為、測試、效能或部署的聲明。本輪尚未獨立複現，尤其 98-test、多版本相容性、延遲與 throughput。

**INFERENCE**：本研究由來源推導的取捨、風險與實驗建議；RESEARCH／SDD 中明示，不冒充實測。

**LOCAL-RUN**：本工作環境真的執行的檢查，目前僅限本研究產物的靜態檢查。詳見 VALIDATION。

## 固定來源清單

| ID | 固定來源 | 讀取範圍 | 用途 |
| --- | --- | --- | --- |
| S01 | [Cargo.toml](https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/Cargo.toml) | full | 版本、最低 Rust、依賴及授權識別 |
| S02 | [docs/architecture.md](https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/docs/architecture.md) | full | 執行緒、保序、背壓、共享後端、快取 |
| S03 | [docs/behavior.md](https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/docs/behavior.md) | full | 交易、重試、遷移、RESP3 行為契約 |
| S04 | [docs/compatibility.md](https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/docs/compatibility.md) | full | 支援範圍、已知限制；上游測試聲明 |
| S05 | [docs/benchmarks.md](https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/docs/benchmarks.md) | full | 上游效能方法、不同版本與模式的結果 |
| S06 | [docs/configuration.md](https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/docs/configuration.md) | full | 預設值、記憶體預算、認證與路由參數 |
| S07 | [docs/operations.md](https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/docs/operations.md) | full | INFO、slowlog、停機與快取容量 |
| S08 | [mithril.conf.sample](https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/mithril.conf.sample) | full | 設定格式與範例 |
| S09 | [Makefile](https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/Makefile) | full | 原生 build/test/lint/fmt-check 入口 |
| S10 | [src/route.rs](https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/src/route.rs) | full | pick、any_master 與讀寫路由測試 |
| S11 | [src/multikey.rs](https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/src/multikey.rs) | lines 1-240 | split、singles、merge_mget、merge_sum、merge_ok、SCAN cursor |
| S12 | [src/shard.rs](https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/src/shard.rs) | full | Fabric、owner、pipe、invalidate、跨 worker 回覆 |
| S13 | [src/server.rs](https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/src/server.rs) | lines 1-210 | admission ticket、placement、bootstrap、ArcSwap、通道建立 |
| S14 | [src/resp.rs](https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/src/resp.rs) | lines 1-170 | frame 邊界、Args 借用切片、增量掃描與上限 |
| S15 | [rust-toolchain.toml](https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/rust-toolchain.toml) | full | 固定 Rust 1.98.0 與 lint 元件 |
| S16 | [Cargo.lock](https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/Cargo.lock) | tree metadata only | 只核對存在及 blob ID；未逐項審查依賴 |

其中 S11、S13、S14 只讀表中指定範圍；S16 只讀 tree metadata。沒有聲稱完整讀取 `client/`、cache、ACL、generated command table、integration suite 或每個依賴。其細節若只由架構／相容性文件取得，一律屬 UPSTREAM-CLAIM。

## 本倉庫對照與規範

基線 `newclear` commit：`268fb9ad7b683a02731e6fc18f8b974ba0c44022`。已讀 root README、PORTFOLIO（含 documentation tiers）、docs/taxonomy、docs/portfolio-doc-tiers、docs/specs/monorepo-ci；另讀 .team/PLAN 的前 65 行以辨識其他 program ownership，未把 dim-gate 規則誤當作本項目的任務授權。

對照：[snail README](https://github.com/fallrising/newclear/blob/268fb9ad7b683a02731e6fc18f8b974ba0c44022/systems/snail/README.md)、[Eru lab README](https://github.com/fallrising/newclear/blob/268fb9ad7b683a02731e6fc18f8b974ba0c44022/labs/eru-vps-mvp/README.md)。這兩項用於問題域／投資邊界比較，沒有重新測試其程式碼。

## 版本、可重現性與授權

`0.1.7` 是 Cargo manifest 值，不是本輪核實的 release tag。Rust toolchain 檔為 1.98.0。沒有解析或下載 container image digest，也沒有獨立驗證 release binary、dependencies、SBOM 或 license obligations。

上游 Cargo manifest 標示 `AGPL-3.0-only`。本項目沒有複製其源碼或整份文件，只保留來源指向、必要事實與原創分析；不得把 newclear 根 MIT 誤套到上游。需要修改／再散布或商業整合時另做授權審查，不以本研究取代法律意見。

本輪 web 存取官方 GitHub 頁面可確認專案定位；部分 Pages/raw 存取失敗，因此研究主要使用 GitHub connector 讀取固定檔案。shell clone 因 DNS 失敗，沒有用臆測取代原始碼閱讀。
