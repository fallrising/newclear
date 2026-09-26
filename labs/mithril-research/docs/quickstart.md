# Quickstart：從四機計劃到可操作實驗

## 現在能做什麼

閱讀 [四機使用計劃](FOUR-NODE-PLAN.md)，並以 [EXECUTION_PROMPT](EXECUTION_PROMPT.md) 接手 MR-004 / P0。Owner 已提供四台測試機，但主機映射與現場盤點尚未完成；本輪只做文檔和 GitHub 交付。

**這裡還沒有一鍵四機啟動包。** Compose、runtime lock、lifecycle CLI、auth templates 與 smoke harness 待 P1 實作；不能執行文件中尚不存在的 up/smoke/down 工具。歷史與本輪驗證見 [VALIDATION](VALIDATION.md)。

## 正式接手順序

完整閱讀 [AGENTS](../AGENTS.md) 指定文件，核對 main／PR／既有工作樹；先唯讀盤點四台與保留服務，再建立精確部署計劃。首輪實機批准後依 P1–P3 完成固定 artifacts、交叉副本、健康／安全、真正讀寫、保留資料重啟與精確清理。

跨機 baseline 使用私網、認證與獨立 run ownership；舊 [mithril.local.conf](../examples/mithril.local.conf) 只供可信單機 loopback 實驗，不可直接複製到四台、改成 wildcard 或連既有 Redis。

上游提供容器、release binary 與 source build；只有 source build 要 Rust toolchain。**不把「本工作環境不能編譯」誤當成「四台不能安裝使用」。** 預編譯 artifact 必須核對來源、架構、commit 與 checksum/digest；不能只看顯示版本。[U01]

## 固定來源建置參考（選用，尚未在本輪執行）

這是隔離 builder 的參考，不是四台主機的安裝指令。前置是已配置 GitHub SSH／host key、git、可取得固定 Rust toolchain 與 dependencies。目錄已存在時先核對，不覆蓋；不要把上游 checkout 放進 newclear 受追蹤路徑。

```bash
set -eu
WORK="$HOME/mithril-study-work"
test ! -e "$WORK"
mkdir -m 700 "$WORK"
git clone git@github.com:projecteru2/mithril.git "$WORK/upstream"
cd "$WORK/upstream"
git checkout --detach 9959fe2e5cd466614dc20ef7b710befaaf1d746a
test "$(git rev-parse HEAD)" = 9959fe2e5cd466614dc20ef7b710befaaf1d746a
rustc --version
cargo --version
cargo build --locked --release
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
cargo fmt --check
sha256sum target/release/mithril
```

上游 rust-toolchain.toml 固定 1.98.0；Makefile 會注入 build metadata，直接 Cargo build 的顯示資訊可能不同。保存 HEAD、toolchain、binary SHA-256、命令／exit status；不能只靠 INFO 認定實際執行的 commit。[U01]、[U04]

## 第一次實際使用會得到什麼

P2 通過後才提供私有 Mithril endpoint、app user、密碼提示式連線指令與本 run key prefix。預期用 standalone redis-cli／SDK 完成 PING、帶 TTL 的 SET、GET、DEL，再用受控 direct backend 核對跨三個 shard 的真實資料；預期回覆見四機計劃 P3。

不要用 Mithril PING／虛擬 CLUSTER 回覆代替六節點檢查，不把預期回覆寫成實測。正常 down 保留資料；同 run up 驗證重啟；purge 另核對精確物件與批准。此流程仍待實作與實機驗收。

[U01]: https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/docs/installation.md
[U04]: https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/rust-toolchain.toml
