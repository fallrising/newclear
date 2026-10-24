# 第 2 輪重現入口

本工具只驗證 [DESIGN M1–M3](DESIGN.md)。真實 PostgreSQL、FastAPI 與既有 fake backend 供應登入、任務、事件與結果；`page.route` 只為 fake backend 不會產生的畫面補證。補拍不是 OpenHands、VM、模型用量或審批後端的驗收。

從元件目錄執行。先以 repository 的 Node 24.18.0、Python 3.12 與鎖檔安裝環境：`npm --prefix web ci`，Python `pip install --require-hashes -r requirements.lock` 後 `pip install --no-deps -e .`。SDK 與套件快取沿用共用位置。原生驗證為 `make platform-check`、`make web-check`；後者包含 typecheck、Prettier、Vitest 與 production build。`make platform-check` 另需原生 Docker CLI、C 開發標頭及現行 Python 套件，包含自己的 host-native 隔離 Docker 測試；不要在 browser capture 容器掛 Docker socket 或放寬網路以勉強執行。既有 `scripts/test-postgres.py` 可為原生測試建立專用資料庫，並非本輪 browser namespace 的啟動器。不要重用正式資料庫或帳號。

獨立 review driver 的檢查（既有 web 依賴，沒有新增套件）：

```sh
node web/node_modules/typescript/bin/tsc -p fe-review/tsconfig.json
node web/node_modules/prettier/bin/prettier.cjs --check fe-review/*.ts fe-review/tsconfig.json
node --test fe-review/runtime.test.ts
node web/node_modules/@playwright/test/cli.js test --config fe-review/playwright.config.ts --list
```

`run-isolated.py` 由外層 orchestrator 提供。它要求 `STATE_ROOT` 是 checkout 外、自己擁有且 mode 0700 的目錄，`BROWSER_CACHE` 指向已有 Playwright 1.63.0 Chromium revision 1243 的共用快取。runtime image 必須預備 Python 鎖定依賴、Node 與瀏覽器系統函式庫；先 build `web/dist`，再使用無網路的隔離 runtime。PG image 固定於入口程式中的 digest。

```sh
python3 fe-review/run-isolated.py --state-root "$STATE_ROOT" --browser-cache "$BROWSER_CACHE" --mode probe
python3 fe-review/run-isolated.py --state-root "$STATE_ROOT" --browser-cache "$BROWSER_CACHE" --mode capture
python3 fe-review/run-isolated.py --state-root "$STATE_ROOT" --browser-cache "$BROWSER_CACHE" --mode capture
```

兩次 capture 必須順序完成。每次建立全新專用 `agent_platform_test` 與隨機密碼，PG 僅綁 loopback、沒有 published port；瀏覽器與 FastAPI 共用這個專用 network namespace。固定的 `.artifacts` 路徑掛上此次外部私有 state，避免修改原 fixture。外層傳入 `PYTHON`、`TEST_DATABASE_URL`（僅環境變數）及非秘密 `FE_REVIEW_RUN_ID`。

Driver 自己啟動未改動的 `scripts/browser-fixture.py serve`，從 mode 0600 的合成憑證檔登入，並且只執行一次 `produce`。它核對 100 個 durable events、連續 sequence、非零恢復 cursor、1 prompt／1 allocation、結果與 reload 不增加副作用。原生 SHA 驗證核對 patternMismatch、瀏覽器 validationMessage、焦點與零 create POST；每個尺寸重新呼叫原生 reportValidity 以顯示提示。

補拍直接引用產品的 `Run`／`TaskDetail`／`Usage` 與 type-only `Approval` 型別。所有覆寫列都標成 `override`；決定受理與錯誤補拍的 POST 只由 route fulfill 回應，不送到真後端。移除所有 routes 後重新核對原任務與副作用計數不變。只有 light；desktop 1440×900、mobile 390×844，沒有增加 dark mode，也不把這些 smoke 當第 3 輪完整 accessibility／performance 驗收。

每次輸出 `runs/<id>/capture.json`，包括實際 driver／產品／fixture SHA-256、版本、每張圖片 hash、實際步驟、健康觀測與子程序退出結果。外層 receipt 記錄 DB／容器隔離與清理。登入 storageState、PNG、標記檔與 raw logs 都 ignored；storageState 為 0600，公開 JSON 經秘密檢查。兩次按穩定的 state／viewport／kind 和語意斷言比對，不比較隨機 ID、時刻、session 或 PNG 是否逐 byte 相同。

失敗時保留該次證據，不覆寫 run ID，不自動重試 mutation。關閉 browser context 失敗仍會獨立嘗試停止 produce 與 serve；serve 必須有 Application shutdown complete 與 Finished server process 兩個訊息，且退出為 0 或 pinned Uvicorn 在完成後重拋的 SIGTERM；缺訊息的 SIGTERM、非零 code 或 SIGKILL 都不能當成功。外層最後核對自己擁有的容器已移除。原生與 runtime 實際結果另見 [本次報告](tasks/round2/report.md)。
