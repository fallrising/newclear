# cc-quota

> **Portfolio doc tier: A (active)** — Runnable entry:
> [docs/quickstart.md](docs/quickstart.md).
> Policy: [docs/portfolio-doc-tiers.md](../../docs/portfolio-doc-tiers.md).
> Investment notes: [PORTFOLIO.md](../../PORTFOLIO.md).

Claude Code 額度的 pacing 監控。每小時在本機採集一次額度快照並寫入 SQLite，另有只讀資料庫的報表指令；消耗速度偏離時間進度時才發 macOS 通知。目的是讓人自己決定下一步派什麼任務，而不是替人決定。

**Status:** 計算、落庫、報表、本機 token 去重與採集失敗處理有離線測試，CI 執行。**真實額度端點與 macOS launchd／Keychain 路徑尚未在目標機器上驗證**，見 [quickstart](docs/quickstart.md)。

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

## 已知限制

- `/api/oauth/usage` 是 Claude Code 內部使用的端點，**沒有公開文件**，欄位可能改變。每次的原始 JSON 都存在 `raw` 表以便回溯。
- 本機 token 加總只含這台電腦的 Claude Code，不含 claude.ai、行動裝置或雲端 session。帳號層級的真實值以 `utilization` 為準。
- access token 過期時採集會失敗並記入 `errors` 表，開一次 `claude` 讓它自動刷新即可。本工具不自行刷新憑證。
- 電腦睡眠時不採集，趨勢會有缺口。
- 通知是無狀態判斷，偏離期間每小時都會提醒，不做去重。

## Boundary

- In scope：單機、單帳號的額度快照、本機歷史與偏離通知。
- Out of scope：刷新或轉存憑證、多帳號、雲端執行、自動調度任務、長期保存外的分析平台。

## Links

- Quickstart：[docs/quickstart.md](docs/quickstart.md)
- 測試：[tests/test_cc_quota.py](tests/test_cc_quota.py)
- CI：[`.github/workflows/cc-quota-ci.yml`](../../.github/workflows/cc-quota-ci.yml)
