# cc-quota

> 主線、驗收條件、剩餘缺口與可用版本：[SUCCESS.md](SUCCESS.md)。


> **Portfolio doc tier: A (active)** — Runnable entry:
> [docs/quickstart.md](docs/quickstart.md).
> Policy: [docs/portfolio-doc-tiers.md](../../docs/portfolio-doc-tiers.md).
> Investment notes: [PORTFOLIO.md](../../PORTFOLIO.md).

Claude Code 額度的 pacing 監控。每小時在本機採集一次額度快照並寫入 SQLite，另有只讀資料庫的報表指令；消耗速度偏離時間進度時才發 macOS 通知。目的是讓人自己決定下一步派什麼任務，而不是替人決定。

**Status:** 2026-10-23 本次離線驗證已完成（28 項測試及 CLI→SQLite→report fixture流程）；見[驗證紀錄](docs/tasks/verification-20261023.md)。CI 執行同一套測試；本輪PR／CI結果見驗證紀錄。**真實額度端點與 macOS launchd／Keychain 路徑尚未在目標機器上驗證**，見 [quickstart](docs/quickstart.md)。

## 設計

```
launchd（每小時）
  └─ cc_quota.py collect ──► /api/oauth/usage（Claude Code 登入憑證）
        │                    $CLAUDE_CONFIG_DIR/projects/*.jsonl（本機 token，選用）
        ├─ 計算 remaining / reset / pace / 耗盡預估
        ├─ 追加寫入 SQLite（~/.local/share/cc-quota/quota.db）
        └─ 偏離時 macOS 通知

cc_quota.py report ──► 只讀 SQLite ──► 最新狀態 + 趨勢
```

- **採集與展示解耦**：`collect` 是 producer，`report` 是 consumer，SQLite schema 是兩者的契約。之後改成網頁或 dashboard 只需另寫讀取端。
- **採集單元無狀態**：每次執行只看當下快照，不讀上一次結果；歷史只存在儲存層。
- **不經過模型**：監控額度的任務本身不消耗被監控的額度。

### 指標

| 指標 | 公式 |
| --- | --- |
| 剩餘% | `clamp(100 - utilization, 0, 100)` |
| 重置倒數 | `max(0, resets_at - now)` |
| 時間進度% | `(now - (resets_at - 視窗長度)) / 視窗長度 × 100` |
| pace | `utilization / 時間進度%`；進度 < 10% 時不計算 |
| 耗盡預估 | `(100 - utilization) / (utilization / 已過秒數)` |

視窗長度：`five_hour` 5 小時，`seven_day` 與 `seven_day_opus` 7 天（回應裡有才記錄）。

### 判讀

| 狀態 | 條件 | 建議 |
| --- | --- | --- |
| OK | 其他 | 照常，不通知 |
| FAST | pace ≥ 1.2 且耗盡預估早於重置 | 收斂，延後大任務 |
| SLOW | pace < 0.8 且視窗已過半 | 額度會浪費，可排重任務 |
| LOW | 剩餘 < 15% | 只做必要的事 |

門檻可用 `CC_QUOTA_PACE_HIGH`、`CC_QUOTA_PACE_LOW`、`CC_QUOTA_REMAIN_MIN` 覆寫；資料庫位置用 `CC_QUOTA_DB`。

判定使用未四捨五入的數值；顯示的 pace 才保留兩位小數。

`report` 以 SQLite `mode=ro` 開庫，不建立目錄、資料庫或schema。剩餘／pace／狀態標示為快照時觀測值，倒數依時間推算。快照超過90分鐘或視窗已重置會標 `STALE`；趨勢中超過90分鐘的兩次採集間隔標 `GAP`，未知期間不補值。

來源缺／錯 utilization、非有限值、無時區或無效 reset 均視為採集失敗；全部提供的視窗驗證成功才寫 snapshots。可選視窗缺席／null 不補0；全無有效視窗則失敗。成功取得的 JSON（含錯誤schema）仍留 `raw`，`errors`只記階段／型別／HTTP碼，HTTP401提供重新開啟Claude的提示。

## 已知限制

- `/api/oauth/usage` 是 Claude Code 內部使用的端點，**沒有公開文件**，欄位可能改變。每次的原始 JSON 都存在 `raw` 表以便回溯。
- 本機 token 加總只含這台電腦的 Claude Code，不含 claude.ai、行動裝置或雲端 session。帳號層級的真實值以 `utilization` 為準。
- access token 過期時採集會失敗並記入 `errors` 表，開一次 `claude` 讓它自動刷新即可。本工具不自行刷新憑證。
- 電腦睡眠時不採集，趨勢會有缺口；GAP／STALE 表示缺觀測，不推斷缺口一定由睡眠造成。
- 本機 token 以 `(message.id, requestId)` 去重；缺 requestId 時使用 message.id，缺 message.id 則逐筆計數，無法保證匿名重複記錄去重。加總沿用 input/output/cache_creation，未加 cache_read；畸形資料略過、超出SQLite整數範圍的加總標未知。
- DB以秒為主鍵；同秒成功重採會取代該秒完整快照，不保留每次呼叫的獨立歷史。
- 通知失敗只記 `errors`，已提交的額度不丟失；collect成功仍回傳0。Keychain／通知子程序有10秒上限。
- 通知是無狀態判斷，偏離期間每小時都會提醒，不做去重。

## Boundary

- In scope：單機、單帳號的額度快照、本機歷史與偏離通知。
- Out of scope：刷新或轉存憑證、多帳號、雲端執行、自動調度任務、長期保存外的分析平台。

## Links

- 任務板：[docs/tasks/BOARD.md](docs/tasks/BOARD.md)
- 本次證據：[docs/tasks/verification-20261023.md](docs/tasks/verification-20261023.md)
- Quickstart：[docs/quickstart.md](docs/quickstart.md)
- 測試：[tests/test_cc_quota.py](tests/test_cc_quota.py)
- CI：[`.github/workflows/cc-quota-ci.yml`](../../.github/workflows/cc-quota-ci.yml)
