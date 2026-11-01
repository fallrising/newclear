# Memvid native Whisper helper

`memvid-sdk==2.0.160` 的 Linux wheel 沒有編入 Whisper。本 helper 直接呼叫固定
`memvid-core=2.0.140` 的 `WhisperTranscriber`，使用 Candle CPU 與官方
`openai/whisper-tiny.en` FP32 模型。Python runner 再將實際轉錄寫入 Memvid 記憶檔。
這條路徑不使用替代 transcription engine，也不把參考逐字稿傳入模型。
原始版本忽略模型 cache 設定，無法在本實驗指定的隔離目錄離線執行。因此明確套用
[local-cache.patch](local-cache.patch) 的兩處初始化變更；輸出標記
`core_patch: local-model-cache-v1`。推論、音訊解碼與模型邏輯維持原始碼。

## 準備

需要 Rust 1.90.0、C/C++ build tools、OpenSSL development headers/libraries。
完整依賴由 Cargo.lock 固定。建置及下載需要網路；模型和音訊約 155 MB。
準備程式下載 SHA-256 固定的官方 crate 至 gitignored `native-whisper/work/`，核對
原始與修改後的檔案雜湊，且驗證程式與已提交 patch 完全一致。上游 source 不納入 Git。
本 binary 的原始碼基準是官方 crate archive
`c1d781d355751509b0a845a9203eb2db5a4e2b9750f193380439378a61080f85` 加上明示補丁。
該 archive 的 `.cargo_vcs_info.json` 記錄 commit
`92b0ec8a9b5d964f0da5cf7704a67148fba1b5ed`、`dirty: true`，不能用這個 Git commit
單獨重建發布內容。`e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813` 只是本 lab 的 README／文件閱讀基準，
不是此 binary 的編譯來源。重現以 archive 和 patched 檔案雜湊為準。

在 `labs/memvid-lab` 中：

```sh
python3 native-whisper/prepare_core.py
cargo +1.90.0 build --locked --release --manifest-path native-whisper/Cargo.toml --target-dir work/whisper-build
python3 native-whisper/prepare_assets.py work/whisper-assets
python3 native-whisper/prepare_assets.py work/whisper-assets --verify-only
```

若有 OpenSSL headers/library 但沒有 pkg-config，可顯式設定與平台相符的
`OPENSSL_INCLUDE_DIR`、`OPENSSL_LIB_DIR`；本次 Linux x86-64 環境使用 `/usr/include`
與 `/usr/lib/x86_64-linux-gnu`。不需要修改或安裝系統套件。

## 執行與判定

```sh
HF_HOME="$PWD/work/whisper-assets/hf-home" \
  work/whisper-build/release/memvid-lab-whisper work/whisper-assets/jfk.flac
```

成功只向 stdout 輸出 JSON，含原生 engine、模型、實際 text、duration、language 與 segments。
模型／音訊缺失、初始化／解碼失敗、空轉錄均以非零結束；stderr 是錯誤 JSON。
上層還須斷言實際內容及 Memvid 查詢結果，不能只看此程式退出碼。

`WhisperConfig.offline`、`models_dir` 及 `HF_HOME` 在上游此版本的初始化實作中都沒有控制
cache；`Api::new()` 使用預設使用者目錄。原始版已實測在預填 `HF_HOME` 且禁止網路時失敗，
嘗試下載 config。補丁將 cache 明確設定為 `config.models_dir/hub`，且關閉 token 與下載進度；
helper 以 `HF_HOME` 提供此設定，不修改 `HOME`。準備程式將固定 revision 放入 cache 並核對
每個檔案的 SHA-256；helper 拒絕 cache 缺失或 revision 不符。本專案完整驗收由上層 Linux
syscall network blocker 執行，確認本地模型運算在禁止網路的程序中成功。單設
`offline=true` 仍不構成離線證據。

`hf-hub 0.4.3` 的 `from_cache()` 會先讀取 cache token，之後才套用 `with_token(None)`。
helper 因此在任何模型初始化之前以 `symlink_metadata` 檢查 `HF_HOME/token`，只要有任何
目錄項目便拒絕執行，包含一般檔、目錄和 dangling symlink；不能確認不存在時也拒絕。
請使用本實驗獨立的無憑證模型目錄。此檢查不會讀取或顯示 token 內容。
可執行 `python3 native-whisper/test_token_guard.py work/whisper-build/release/memvid-lab-whisper`
驗證三種 token entry 均在初始化前退出。

## 資產來源與授權

固定下載 URL、大小與 SHA-256 保存在 [prepare_assets.py](prepare_assets.py)；下載後的 manifest 只記公開來源。

- 模型、config、tokenizer：[OpenAI whisper-tiny.en](https://huggingface.co/openai/whisper-tiny.en/tree/87c7102498dcde7456f24cfd30239ca606ed9063)，model card 宣告 Apache-2.0。
- 音訊：[OpenAI Whisper JFK 測試 fixture](https://github.com/openai/whisper/blob/86098128c0b4f24f0e2aa2994de830614b474227/tests/jfk.flac)，來源 repository 為 MIT；內容為美國聯邦官員公開演說片段。
- 原生引擎：[Memvid](https://github.com/memvid/memvid/tree/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813)，Apache-2.0。

模型及音訊不納入 Git；只在準備步驟下載。
