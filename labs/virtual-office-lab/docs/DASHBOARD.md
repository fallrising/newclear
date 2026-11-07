# 本機唯讀狀態頁（T-0007）

先依 RUNBOOK 啟動 local workerd（預設 127.0.0.1:8787），再從元件目錄執行：

```sh
npm run preview
# 開啟 http://127.0.0.1:8790
```

可用 `OFFICE_PREVIEW_BACKEND=http://127.0.0.1:其他埠` 指向已授權的本機公開狀態 API。僅接受 loopback HTTP origin，沒有 token、登入或寫入 API。preview 僅綁 loopback，限制 Host 與固定 GET 路由，不把 repo root 當 static root。`web/` 是獨立頁面來源；presentation 模組只有一條明確靜態映射。不是 production hosting／部署。

頁面以 textContent 建立唯讀清單，標示 demo、stale、alert、斷線與最後成功 ISO 時間。斷線保留最後成功資料，無資料則明示，不補假資料。每 15 秒加最多 1 秒 jitter，失敗退避至最多 60 秒；單一 in-flight、5 秒 timeout；隱藏頁面停止輪詢並取消請求，恢復重抓。使用者隱藏造成的 abort 不算網路故障。純文字頁無動畫，預設滿足 reduced-motion；尚無 3D 或相機。

## 驗證與範圍

- Node tests 涵蓋 allowlist／唯讀 API、backend 故障、polling 單一請求、退避、保留 snapshot、隱藏暫停與恢復；polling 使用 VM 假 DOM／clock，不冒充瀏覽器。
- `OFFICE_CHROME=/path/to/chrome npm run test:browser` 啟動真 headless Chrome，以獨立臨時 profile 與明示 demo fixture 驗證 stale/error、最後成功時間、惡意名稱只成為文字節點。未使用 no-sandbox。CI 使用 runner 既有 google-chrome，版本由 runner 提供，不宣稱固定瀏覽器版本。
- 真 Chrome smoke 不涵蓋全部斷線／visibility 矩陣，這些目前是 Node VM 回歸；未完成 Three.js、手機相機、螢幕閱讀器人工驗收或完整 AC-06。
- Claude Opus 5.5 無工具唯讀 review 指出 stdout 應等 close、hidden abort 不應增加失敗、Host 防護；已修正並補回歸。確認 presentation 無 imports、boundedJson 流式限額、index 無 inline script/style。模型 review 不取代實際測試。

未部署、沒有新模型 provider 接入或 usable tag。
