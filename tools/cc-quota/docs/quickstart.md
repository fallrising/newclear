# Quickstart — cc-quota

> Tier A. 標為 `skipped` 的步驟尚未在目標環境執行，原因附在旁邊。

## Prerequisites

- macOS，已安裝並登入 Claude Code（`claude`），憑證位於 Keychain 的 `Claude Code-credentials`。
- PATH 上的 `python3` 需為 **Python 3.11+**，只用標準函式庫。安裝器固定使用當時找到的解譯器絕對路徑；不要假設 macOS 的 `/usr/bin/python3` 版本足夠。
- Linux 亦可手動執行：憑證改讀 `$CLAUDE_CONFIG_DIR/.credentials.json`（預設 `~/.claude`），通知改印到 stdout；沒有 launchd 設定。

## Minimal path

```sh
# 在 tools/cc-quota 目錄
bash install.sh                                  # skipped: 需要 macOS 與 launchd
python3 ~/.local/bin/cc_quota.py collect -v      # skipped: 需要真實 Claude Code 登入；首次會跳 Keychain 授權，選「永遠允許」
python3 ~/.local/bin/cc_quota.py report          # skipped: 依賴上一步的資料
```

`install.sh` 會把腳本複製到 `~/.local/bin`，在 `~/Library/LaunchAgents` 建立每小時執行一次、登入圖形工作階段並載入時也跑一次的設定並載入。結尾會印出解除安裝指令。非macOS在任何安裝寫入前拒絕。

安裝時會保存當時設定的 `CLAUDE_CONFIG_DIR`、`CC_QUOTA_DB`、`CC_QUOTA_PACE_HIGH`、`CC_QUOTA_PACE_LOW`、`CC_QUOTA_REMAIN_MIN`（路徑轉絕對路徑）；改設定後需重跑安裝器。只保存這五個非憑證選項，不保存完整環境、token或 `CC_QUOTA_MOCK`。macOS Keychain仍使用預設 `Claude Code-credentials` service，非預設帳號／自訂service不在本輪驗收範圍。

## Verify

```sh
# 離線驗證（CI 執行的同一組）：不需要網路或憑證
python3 -m unittest discover -s tests -v
bash -n install.sh
```

在目標機器上，`launchctl print gui/$(id -u)/io.github.fallrising.cc-quota` 可以確認排程已載入（skipped: 需要 macOS）；`~/.local/share/cc-quota/collect.err` 是 launchd 的錯誤輸出。

## 目標 Mac 驗收（尚未執行）

本輪只有Linux；8個SSH候選條目均為Linux。以下是待執行步驟，不是本次通過證據：

1. 在授權Mac確認 `python3 --version` ≥3.11、Claude Code已登入；從本目錄先跑 `python3 cc_quota.py collect --no-tokens -v`。Keychain授權需要人在Mac上完成。若401，先開Claude更新登入；工具不刷新憑證。
2. 將 `python3 cc_quota.py report` 的時間、five_hour／seven_day及來源提供的opus使用率／reset與Claude可見額度逐項比對。只記去識別的數值與結果；不複製token、帳號、raw JSON或完整Keychain輸出。
3. `bash install.sh`，再跑 `launchctl print gui/$(id -u)/io.github.fallrising.cc-quota`，確認實際載入的解譯器、每3600秒與RunAtLoad設定。保留去識別結果，勿公開整份launchctl輸出中的私有路徑。
4. 記錄安裝後快照時間，在Mac保持清醒且登入的情況下等待超過一小時，再由 `report` 確認新增快照。單次手動collect或mock launchctl不算排程驗收。
5. 當真實快照達README門檻時核對通知內容與可見通知。必要時可在單次手動命令暫設 `CC_QUOTA_REMAIN_MIN=101 python3 cc_quota.py collect --no-tokens -v` 觸發通知，明示使用測試門檻；此單次命令不改排程設定，也不算預設門檻的真實觸發證據。
6. 真正睡眠／恢復後核對歷史時間與GAP／STALE提示（超過90分鐘的缺口），確認恢復採集，未知期間沒有補造正常資料。通知權限／Focus可能影響可見性，必須實際觀察。

若安裝失敗，保留錯誤與已寫入的腳本／plist供檢查，不能視為已啟用。解除排程用安裝器列出的bootout命令；保留DB與歷史，勿清理憑證或資料目錄。

## Authoritative longer docs

- 本次離線證據／剩餘阻塞：[tasks/verification-20261023.md](tasks/verification-20261023.md)
- 設計、指標與限制：[../README.md](../README.md)
