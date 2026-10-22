# Handwired Learning

> **HW-0 與 HW-1 已通過本機驗證；HW-2 學習區、HW-3 真人試用待做。** 主線與可用版本見 [SUCCESS.md](SUCCESS.md)。

調整 `y = a × x + b`，比較 JavaScript Number 與真正的 Handwired CPU / FP32 數值圖。滑桿或數字欄每次輸入立即重算；非法值清除結果與通過標記。固定允差不會為結果放寬。Builder 建立固定圖，runtime 執行新數值；不是任意 JS 編譯器，也沒有 GPU 或一般智能宣稱。

## 本機開啟

使用 Node **24.14.0**，不需要 npm 安裝。依 [固定版本 API 支援表](docs/upstream-api.md) 下載上游 core 與 LICENSE 到 repo 外並設定 `HANDWIRED_ROOT`。建置先核對兩者的 SHA-256，再用 Node 內建 TypeScript stripping 產生含 MIT 授權的單一 HTML：

```sh
node labs/handwired-learning/scripts/build.mjs /absolute/existing/output-directory/handwired.html
```

輸出必須是 repo 外的絕對 `.html` 路徑，父目錄須已存在，檔名須尚未存在（避免覆寫）。直接用瀏覽器開啟該檔案（`file://`）；不需要伺服器、登入、網路或上傳。不要直接打開 `web/index.html`，它是尚未嵌入固定上游的建置模板。中文字體使用本機系統字體。

共用 agent 環境的 build/test 必須經 `agent-workspace/workspace.py run handwired <unique-task> -- <command>`；將產物放在 `AGENT_ARTIFACTS_DIR`，不要放入來源樹。

## 驗證

```sh
node --test --test-isolation=none labs/handwired-learning/tests/api-probe.test.mjs labs/handwired-learning/tests/forward.test.mjs labs/handwired-learning/tests/build.test.mjs
node labs/handwired-learning/examples/api-probe.mjs
```

測試同樣需要 `HANDWIRED_ROOT`；以固定真實上游驗證，缺來源或雜湊不符就失敗。13 項 Node 測試涵蓋九點／邊界／小數、非法輸入先於圖執行、重算、固定允差、離線產物及來源漂移。另有真實 Chromium 的離線互動紀錄；詳見 [HW-1 報告](tasks/459-hw1/report.md)。

[SDD](docs/SDD.md) 定義完整 MVP；[API 支援表](docs/upstream-api.md) 與 [HW-0 報告](tasks/450-hw0/report.md) 保留上游核對。HW-2、HW-3 未驗收，`usable_tag` 仍為 `none`。最終 CI、獨立審查與合併回讀記於 [PR #460](https://github.com/fallrising/newclear/pull/460)。
