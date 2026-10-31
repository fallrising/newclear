# 前端共用呈現模型（T-0006）

`src/presentation.mjs` 的 `present(publicState, options)` 接受 `/state` 公開格式，輸出 banner 與排序後的 bot 文本／zone／position／badges。零 runtime 依賴，不讀網路、不讀秘密、不改輸入。

- options：`connected` 預設 true、`nightEnabled` 預設 false，兩者必須 boolean。
- 夜間依 serverTime、Asia/Singapore 22:00–08:00，僅無警示 idle/stale 可投影到出口；不是協定第九個狀態。
- stale/error/needs-you 保留文字警示，不因 idle 或夜間被抹掉。
- meeting 只接收雙方互相列出、fresh、無警示、非 idle/done 的角色。按 ID 穩定 greedy 選最多兩對，四個位置不重複；多餘角色留原工位。
- 斷線停止可移動標記、保留最後資料與斷線 badge，絕不自動變成 demo。demo 狀態即使斷線仍保留模擬標記。
- 此處 position 是**目標點**，不是當前動畫座標或合法路徑；stale 不應動畫移動。未知工位回 null，可用文字 fallback。休息點目前為有限配置，可能共享；不能聲稱碰撞或多人路徑驗收。
- name/role/summary 都是資料字串，不產生 HTML。未來 DOM renderer 必須 `textContent`，Canvas 必須 `fillText`；目前字串保留測試不是瀏覽器 XSS 驗收。

尚未實作 Three.js、WebGL fallback UI、polling、reduced-motion、done revision 動畫、瀏覽器測試。完整 AC-06 仍 pending。

## 本輪證據

Node syntax/tests 通過（48 tests）；全倉 indexes／success contracts 通過。純函式測試涵蓋八狀態、過期警示、單向／雙向協作、排序穩定、四座位上限、夜間時間邊界、斷線非 demo、不改輸入與未知工位。

Claude CLI 以 canonicalModel `claude-opus-5-5`、safe-mode、無工具、每次 USD 2 budget 進行公開程式與測試唯讀 review，結論 PASS、無 blockers。非阻擋建議中的 options 型別、status 警示防禦、驗證後才排序、斷線 demo 回歸已補強；共享休息位置與動畫路徑保留 renderer 階段驗收。模型 review 不等同人工批准或實際瀏覽器驗證。原始回應未包含於 repo，以免帶入 session metadata。
