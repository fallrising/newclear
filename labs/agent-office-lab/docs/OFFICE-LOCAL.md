# Office 本機基底驗證

> 公開匯入版：先依 [SETUP](SETUP.md) 設定環境（research 文件請見 ../docs/SETUP.md）。原 runs 的連結改指向歷史摘要，原始日誌及截圖不公開。

2026-10-31 已完成固定基底的安裝、建置、完整測試與瀏覽器 smoke test。後續 **OpenCode＋Strata live integration 已通過**，使用 [OpenCode 本地工位](OPENCODE-LOCAL.md) 的命令啟動可工作的 demo；本頁的 `office.mjs` 仍是預設 agent 關閉的純基底預覽。

## 安裝與版本

- Checkout：`../vendor/agent-office/`，commit `852e2ab28c4f3f31bffdf4b20353bd119c9d3270`。
- Node `v23.11.0`，npm `10.9.2`。
- 使用上游 `package-lock.json`，`npm ci --ignore-scripts --no-audit --no-fund`；npm cache 在 lab 的 `.npm-cache/`。
- 未修改上游 tracked 檔案，MIT LICENSE 留在 checkout 中。Lab launcher 位於 [office.mjs](../scripts/office.mjs)。

## 已驗證

| 項目 | 結果／證據 |
|---|---|
| TypeScript | [typecheck（歷史摘要）](evidence/README.md)，exit 0 |
| 前端與 server 建置 | [build（歷史摘要）](evidence/README.md)，exit 0 |
| 上游完整測試 | [tests（歷史摘要）](evidence/README.md)，614 passed、0 failed，約 29.8 秒 |
| 合成 demo 專案 smoke | [result.json（歷史摘要）](evidence/README.md)，completed |
| 瀏覽器實際畫面 | [lite.png（歷史摘要）](evidence/README.md)，登入後 demo 工位頁面，無 JS pageerror |

Smoke 驗證 loopback bind、health、未登入 API 的 401、lite 登入 redirect、密碼登入、whoami、lite HTML 及瀏覽器暱稱登入後畫面。沒有啟動 worker。結束後關閉 browser 與 Office，`cleanup_completed=true`。

沙箱內初次 npm 安裝遇到 DNS 限制；放行後使用相同 lockfile 安裝成功。沙箱內完整測試因 sockets／PTY 限制出現失敗並被中止，原 [log（歷史摘要）](evidence/README.md) 保留；必要權限放行後才取得完整 614／614 結果。首次 smoke 的 loopback EPERM 及一次錯誤的頁面文字等待也保留各自 run；沒有把它們當成功。

## 操作

從元件目錄執行，測完自動關閉：

```sh
node scripts/office.mjs --screenshot
```

啟動本機預覽並留在前景：

```sh
node scripts/office.mjs --serve
```

預覽網址為 `http://127.0.0.1:4600/lite`；終端會顯示一次性登入連結。Ctrl+C 關閉。預覽 demo 在 `projects/demo/`，只包含合成資料；smoke 使用每次 run 自己的 demo。每次啟動產生新的隨機密碼，不能用舊密碼登入。

Launcher 固定 loopback、最大一個 worker、停用 webhook、自動開瀏覽器與預設 agent（`/usr/bin/false`）。這仍是上游功能預覽，**不是已完成三工位限制的 MVP**；上游 provider 選單仍存在。它不會自動啟動 Strata，也沒有實作 Office 程序樹的 OS 級網路隔離。

## 下一步

1. OpenCode＋Strata 的 AC-02 已完成，下一步補權限等待／resume 等生命週期驗收。
2. Grok 版別待確認；Pi + DeepSeek 需顯式遠端模式與使用者自己的憑證。不要使用私人任務驗收。
3. 實作三工位入口與完整狀態、取消、產物流程，逐項完成 SDD 的 AC-01–AC-09、AC-11。

本次 PATH 仍找不到 `opencode`、`grok`、`pi`；未登入任何遠端模型服務。614 個上游測試使用其測試設施，不能代替真實 provider 任務。
