# 統一偵測與派工

從元件目錄執行。下列命令只偵測或顯示計畫，不送模型 prompt：

```sh
python3 scripts/office_dispatch.py detect
python3 scripts/office_dispatch.py detect --provider grok
python3 scripts/office_dispatch.py plan pi
python3 scripts/office_dispatch.py run cursor
```

`detect` 核對四個固定 CLI 的實際版本與 help 能力，使用隔離 HOME 及 macOS sandbox 拒絕網路。OpenCode 1.19.5 使用有期限／輸出大小限制的 PTY，避免原生 help 在 pipe 中截斷。只讀取憑證檔案的種類、權限及大小，不讀取內容或呼叫登入 API。`credentials: present_unverified` 不代表登入有效；`model` 是固定選定模型，不代表本次已推論。

`launch_prerequisites_present` 表示 CLI、固定 Office build、runtime 與必要憑證檔案存在；實際認證與模型能力仍由 runner 判定。偵測的 exit code 只反映 CLI 相容性，完整啟動條件須看每列欄位。缺安裝依 [SETUP](SETUP.md)；Pi／Grok 登入依 [REMOTE-SETUP](REMOTE-SETUP.md)，Cursor 依 [CURSOR](CURSOR.md)。OpenCode 需要既有 `STRATA_HOME`，偵測只檢查檔案，不啟動模型。

## 明確執行

`run` 預設等同 plan。必須有 `--execute` 才啟動一個既有合成檔案 runner；遠端還必須有 `--allow-remote`。下列遠端命令會消耗配額／可能產生費用，僅在取得當次單次授權後執行；先前成功的授權不自動延續。

```sh
python3 scripts/office_dispatch.py run opencode --execute
python3 scripts/office_dispatch.py run grok --execute --allow-remote
python3 scripts/office_dispatch.py run pi --execute --allow-remote
python3 scripts/office_dispatch.py run cursor --execute --allow-remote
```

入口固定 provider、模型、合成任務及 argv，不接受自由 prompt、shell、自訂模型、timeout 或放大限額；不使用 shell 拼接、不自動 fallback、不自動重試。OpenCode 使用 `STRATA_HOME/source/.venv/bin/python`，其他 provider 使用目前 Python。原生 runner 的結果仍寫到 `runs/`，以[結果入口](RESULTS.md)查看。

本地取消驗收可明確選擇：

```sh
python3 scripts/office_dispatch.py run opencode --check-cancel
python3 scripts/office_dispatch.py run opencode --execute --check-cancel
```

第一行只顯示計畫。第二行會啟動本地 Strata，先完成合成檔案任務，再讓同 session 執行固定的 sleep 測試，經原生 Office 取消並核對所屬程序退出；這個選項不能用於遠端 provider。正常本地執行中按 Ctrl+C 會記為 `cancelled`、exit code 130；若清理未確認仍降為 failed 並保留執行阻擋。資源 guard 的 SIGTERM 保持 failed，不冒充使用者取消。已完成的 keep-open 預覽停止則保留 stopped。

| Provider | 固定模型 | 本入口沿用的預設範圍 |
| --- | --- | --- |
| OpenCode | strata/qwen3.8-flash-next-q2_0 | 原本地合成 runner、32K context 與資源 guard |
| Grok | grok-4.6 | 240 秒、4 次工具 hook gate、6 原生 turns；hook fail-open 限制仍存在 |
| Pi | deepseek/deepseek-flash | 180 秒、最多 4 請求、每次最多 512 output tokens |
| Cursor | composer-2.5 | 120 秒、4 次工具 hook gate |

Grok／Cursor 沒有可保證的 request／token／金額硬上限；工具 hook gate 不是服務端費用上限。CLI plan 的 `null` 表示沒有在此保證的上限，不能當成 0。這個入口不會自動套用先前一次性的翻倍批准。

## 無付費故障檢查

`run pi --check-failure 401` 或 `429` 預設只顯示計畫；加 `--execute` 後啟動真實 Pi，僅接收本機錯誤回應，不讀 owner key、不連遠端模型。此模式不需登入檔，仍需 CLI／Office runtime；不可同時加 `--allow-remote`。詳見[故障驗收](FAILURES.md)。

`run pi --check-crash` 預設只顯示計畫；加 `--execute` 後，在本機請求留住且原生 Pi working 時對本 run 的 CLI 注入 SIGKILL。不讀 owner key、不連遠端模型，不可混用其他驗收模式或 `--allow-remote`。清理完成後可另以 `run_pi_work.py --check-startup` 明確啟動新 session，詳見 [CLI crash 驗收](CRASH.md)。

## 明確重試

`retry pi-work-...` 只顯示計畫；`--execute` 只啟動一次。必須指定最新且完整清理的失敗紀錄，同一 Pi 任務最多兩次重試；新 workspace／session 沿用原 fixture。遠端仍需當次付費授權及 `--allow-remote`，本機故障模式不接受此旗標。詳細限制與中斷處理見 [RETRY](RETRY.md)。

## 單一執行與中斷

四個 `run_*_work.py` 的直接命令及統一入口共用本 lab 的 `state/dispatch/execution.lock`。第二次執行會立即回報 `execution_busy`；沒有背景等待佇列。鎖跨 dispatcher 的 `exec` 保留，同一 PID 的 runner 接手後持有到清理完成；不增加中間父程序攔截 Ctrl+C，仍由各 runner 處理原生清理。

開始前寫入私有 `active.json`。runner 僅在既有清理判定通過後解除；強制 kill、未處理異常或清理未確認會留下紀錄，下次回報 `cleanup_unconfirmed`，不因舊 PID 消失就自動重跑。鎖是單 checkout 的合作協定，不能約束另一 checkout、舊版腳本或手動直接啟動的原生 CLI。請勿以多份 checkout 同時啟動同一個本地模型。

若確認中斷，先檢查保留的 run 報告與其所屬程序，完成必要清理。只有**已確認所有該 run 程序停止**，才可明示承認：

```sh
python3 scripts/office_dispatch.py acknowledge-interruption --confirm-all-owned-processes-stopped
```

此命令只是操作者確認，不會偵測／停止／恢復任何程序，不會執行模型；仍有持鎖程序時不能解除。它將舊紀錄移到 `acknowledged-*.json` 保留，不刪除檔案證據、不按程序名稱批量 kill。不得把這個旗標當自動故障恢復。

## 驗證範圍

[本輪證據](evidence/dispatch-2026-11-01.json)：真實四 CLI 的斷網版本／help 檢查通過；離線測試覆蓋預設不執行、未授權拒絕、固定 argv、直接 runner 互斥、真實 helper 程序 exec 繼承與強制 kill 後阻擋。117 項離線測試通過。

上述為 T-0012 的前置驗證。T-0013 已完成[新入口本地實測](evidence/local-dispatch-2026-11-01.json)：最終 runner 整輪任務／取消驗收 54.95 秒、原生取消及程序退出 202 ms；Ctrl+C 的另一個 run 顯示 cancelled／exit 130，包含模型關閉的整體退出為 10.399 秒。所有追蹤程序退出、鎖釋放、重複派工拒絕及結果頁核對通過；122 tests 通過，沒有遠端模型呼叫。原生取消與整體 runner 中斷是不同測量，不宣稱所有中斷均在 202 ms 完成。

完整 AC-01、AC-06、AC-08、AC-11 與 MVP 保持 pending，後續仍須驗證遠端新入口、跨 provider 權限／取消／恢復與 UI 派工。
