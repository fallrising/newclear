# 統一結果入口

從元件目錄執行，讀取既有四種原生 runner 的合成任務結果：

```sh
python3 scripts/office_results.py
python3 scripts/office_results.py --provider grok
python3 scripts/office_results.py --show '1:grok-work-20261101T105935002241Z'
python3 scripts/office_results.py --html runs/results.html
open runs/results.html
```

`--show` 使用查詢結果中的 ID；上例須有該筆本機 run。HTML 提供四工位概況、provider／狀態篩選、模型與產物詳細內容。產物直接從快照查看，不提供任意路徑下載。沒有安裝新依賴、啟動服務或 agent；重新整理也不重跑任務。

預設只讀本元件 `runs/`。若歷史紀錄位於其他 checkout，以 `--runs-root` 明確指定，可重複使用；ID 前綴 `1:`、`2:` 依輸入根目錄順序區分同名紀錄，不是永久 ID。不要重複指定同一根目錄以免重複列出。不自動搜尋其他專案或讀取登入設定。

```sh
python3 scripts/office_results.py --runs-root ./runs --runs-root /path/to/other-lab/runs --html runs/combined-results.html
```

HTML 是產生當時的離線快照，檔案權限 `0600`；只允許建立新檔，不覆寫現有檔案。後續結果有變動時請換一個輸出檔名重新產生。乾淨 checkout 沒有私人 runs；須先有既有任務紀錄，公開證據不能當作原始產物。

## 結果如何判定

- `completed`：runner 記錄模型推論通過、原生完成證據／模型與 provider 一致、清理通過，且現在的產物內容符合 input、SHA-256 與原紀錄一致。
- `failed`／`stopped`：保留原 runner 的失敗或停止，產物正確也不能改成成功。
- `cancelled`：本地任務收到使用者 Ctrl+C，與失敗分開顯示；已存在產物仍不代表該任務完成。清理未確認的 runner 會回報 failed。
- `startup_only`：僅啟動檢查，沒有任務驗收。
- `incomplete`：缺少最終報告，無法從靜態檔案判定程序是否仍在執行。
- `unverified`：報告聲稱完成，但缺模型／完成／清理證據，或產物遺失／內容或 hash 不符。
- `invalid`：報告不合法、不可讀、超大、不支援的 runner 或符號連結。

只列出 `local-work-*`、`grok-work-*`、`pi-work-*`、`cursor-work-*`；舊 Codex／非 Office OpenCode 紀錄會標不支援，其他格式不掃描。最多 1,000 筆，單報告最多 2 MiB，兩個合成檔案各最多 4 KiB。每層 run／workspace 與檔案以 descriptor-relative `O_NOFOLLOW` 讀取，拒絕連結及非一般檔案。輸出只保留 provider、原生紀錄模型、已記錄版本、狀態、時間、清理布林與核對過的合成產物；不複製任意日誌、錯誤內容、session、URL、私人路徑或登入資訊。

這會重新驗證產物，**不會重新執行模型或重播原生 hooks**；原生事件／推論判定仍信任本機 runner 先前留下的證據。若有人同時竄改報告、input 與產物，本工具不是簽章或防偽驗證器。版本未記錄時顯示未知，不用目前已安裝版本回填歷史。

[Pi 故障測試](FAILURES.md) 會明示本機注入來源；任務仍為 failed，另顯示故障驗收結果。必須同時具備原生錯誤、單一本機請求、零外部模型請求、無產物與程序全退出紀錄，才顯示測試通過；舊紀錄缺任一證據不採認。

## 驗證與剩餘範圍

```sh
python3 -m unittest discover -s scripts -p 'test_*.py' -q
node --test scripts/*.test.mjs
node scripts/check_office_results_browser.mjs runs/combined-results.html
```

瀏覽器檢查需既有 vendor 的 playwright-core、本機 Chrome，以及包含四 provider 成功紀錄的快照；驗證篩選、詳細產物與 hash、重新整理和零額外網路請求。它不會執行付費任務。[本輪證據](evidence/results-console-2026-11-01.json) 回讀既有真實 runs，沒有新推論。

本輪完成 AC-09 的唯讀結果子集與 AC-11 的讀取／顯示邊界子集。完整四工位派工、偵測、單佇列及跨 provider 生命週期尚未整合，完整 AC 和 MVP 仍 pending；本頁不是上游 Office 終端的替代品。
