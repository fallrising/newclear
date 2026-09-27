# Quickstart — cc-quota

> Tier A. 標為 `skipped` 的步驟尚未在目標環境執行，原因附在旁邊。

## Prerequisites

- macOS，已安裝並登入 Claude Code（`claude`），憑證位於 Keychain 的 `Claude Code-credentials`。
- `/usr/bin/python3`（Xcode Command Line Tools 提供），只用標準函式庫。
- Linux 亦可手動執行：憑證改讀 `$CLAUDE_CONFIG_DIR/.credentials.json`（預設 `~/.claude`），通知改印到 stdout；沒有 launchd 設定。

## Minimal path

```sh
# 在 tools/cc-quota 目錄
bash install.sh                                  # skipped: 需要 macOS 與 launchd
python3 ~/.local/bin/cc_quota.py collect -v      # skipped: 需要真實 Claude Code 登入；首次會跳 Keychain 授權，選「永遠允許」
python3 ~/.local/bin/cc_quota.py report          # skipped: 依賴上一步的資料
```

`install.sh` 會把腳本複製到 `~/.local/bin`，在 `~/Library/LaunchAgents` 建立每小時執行一次、開機時也跑一次的設定並載入。結尾會印出解除安裝指令。

## Verify

```sh
# 離線驗證（CI 執行的同一組）：不需要網路或憑證
python3 -m unittest discover -s tests -v
bash -n install.sh
```

在目標機器上，`launchctl print gui/$(id -u)/io.github.fallrising.cc-quota` 可以確認排程已載入（skipped: 需要 macOS）；`~/.local/share/cc-quota/collect.err` 是 launchd 的錯誤輸出。

## Authoritative longer docs

- 設計、指標與限制：[../README.md](../README.md)
