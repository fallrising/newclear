# Quickstart：接手研究，不等於已驗證部署

## 本輪可用與不可用

可用：閱讀 [RESEARCH](RESEARCH.md)、[SDD](SDD.md) 和固定來源。本輪所有下列 upstream build／runtime 命令均為 **SKIPPED**：工作環境沒有 cargo、rustc、Docker、redis-server 或 redis-cli，且 shell 無法解析 github.com。GitHub connector 可讀寫 repository，但不能代替 runtime 執行。詳見 [VALIDATION](VALIDATION.md)。

這裡提供接手命令，**不是已跑通的完整 Redis Cluster quickstart**。叢集 fixture 尚待 MR-004 實作；不要以真實 Redis 代替它。

## 1. 在獨立工作目錄取得固定上游

前置：git、可使用 GitHub SSH 的帳號／已驗證 host key、Rust toolchain 安裝能力；不要關閉 StrictHostKeyChecking。`$HOME/mithril-study-work` 應是新目錄，已有目錄時先核對，不覆蓋。

```bash
set -eu
WORK="$HOME/mithril-study-work"
test ! -e "$WORK"
mkdir -m 700 "$WORK"
git clone git@github.com:projecteru2/mithril.git "$WORK/upstream"
cd "$WORK/upstream"
git checkout --detach 9959fe2e5cd466614dc20ef7b710befaaf1d746a
test "$(git rev-parse HEAD)" = 9959fe2e5cd466614dc20ef7b710befaaf1d746a
git status --short
```

不要把 checkout 放入 newclear 的受追蹤子目錄，不建立 submodule 或複製上游 LICENSE／程式碼到本研究。下載與保存上游副本的行為與本研究成果分開。

## 2. 建置與原生檢查（本輪未執行）

固定來源要求 Rust 1.98，toolchain 檔固定 1.98.0、rustfmt 與 clippy。Makefile 的原生入口是 build/test/lint/fmt-check；下列直接用 Cargo 加 `--locked`，避免解析依賴時改動 lockfile。[S01], [S09], [S15]

```bash
# 仍在 "$WORK/upstream"；rustup 會依 rust-toolchain.toml 使用固定 toolchain。
rustc --version
cargo --version
cargo build --locked --release
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
cargo fmt --check
sha256sum target/release/mithril
```

保存 toolchain 版本、stdout/stderr、exit status、binary SHA-256、HEAD、完整設定 hash。直接 Cargo build 與 Makefile 注入的 build metadata 可能不同；不能只靠 INFO 的顯示版本判定執行的是哪個 commit。未經編譯成功不進行下一步。

## 3. 啟動前必須先有自己的 disposable cluster

MR-004 尚未交付建立／健康檢查／精確清理腳本。由下一輪建立 digest-pinned 的 3-master/3-replica fixture，驗證 cluster_state、slot coverage、replication 與所有 advertised node address 皆可被 proxy 存取。**bootstrap seed 可達不等於所有後端 node address 可達。**

在此前不執行代理啟動與寫入 smoke。不要把下面的 7001–7003 自動解讀為你的真實服務。

[設定範例](../examples/mithril.local.conf) 只綁 127.0.0.1:7979、限制連線與 buffer、關 cache 與 replica routing，固定 backend-sharding no。無密碼只適用可信、隔離、無不信任本機使用者的實驗主機。跨主機前必須改為私有認證設定並確認傳輸保護。[S04], [S06]

## 4. 已核准 fixture 中的啟動與 smoke（本輪未執行）

先確認 7979 沒有既有服務，將範例複製到私有 `$WORK/mithril.local.conf`，並核對 bootstrap 屬於該 run。前景啟動，在第二個 shell 測試：

```bash
"$WORK/upstream/target/release/mithril" "$WORK/mithril.local.conf"
```

```bash
redis-cli -h 127.0.0.1 -p 7979 PING
redis-cli -h 127.0.0.1 -p 7979 SET 'mithril-study:{smoke}:key' value
redis-cli -h 127.0.0.1 -p 7979 GET 'mithril-study:{smoke}:key'
redis-cli -h 127.0.0.1 -p 7979 DEL 'mithril-study:{smoke}:key'
redis-cli -h 127.0.0.1 -p 7979 INFO
```

預期 smoke 值為 PONG、OK、value、1；這是預期而非本輪實測。它也不驗證 RESP3、跨 slot、故障、cache 或 performance。Ctrl-C 只停止自己的 foreground proxy；cluster 清理由 MR-004 的 ownership-aware 操作器完成，不提供全域 prune。

下一步執行 SDD C01–C05，不先跑高流量 benchmark。

[S01]: https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/Cargo.toml
[S04]: https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/docs/compatibility.md
[S06]: https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/docs/configuration.md
[S09]: https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/Makefile
[S15]: https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/rust-toolchain.toml
