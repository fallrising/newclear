# SDD：fe-review 第 2 輪（newclear）

> 全部14項newclear單位已交付：R2-AC-1～13於2026-10-24合併，R2-AC-14（Fanzloud）由desk T-0433於2026-10-29依原AC交付，R2-AC-E成立。見[結案紀錄](ROUND2-CLOSEOUT.md)。原AC與判準未改；下列狀態與批准文字保留原規格歷史。

**狀態：owner 已於 2026-10-24 明確批准；實作進行中。** Desk T-0380（父卡 T-0379），承接已完成的第 1 輪。Owner 2026-10-24 指示「繼續第2輪。」；本提案把既有已確認 DESIGN 轉成固定驗收與執行順序，本次已完成 desk 運作方法 §4.3 的具體批准；owner 回覆「批准。」（本對話，首次觀測05:46:58Z，非訊息發送秒數）。第一輪的 [SDD](SDD.md) 與 [確認證據](ROUND1-ACCEPTANCE.md) 保持原樣。

## 目標與依據

實作下表中已確認 DESIGN 的修改項目，在 [PROTOCOL](PROTOCOL.md) §0 的獨立 network namespace 內以 loopback、即時合成資料／認證啟動 UI，跑既有元件檢查，留下可重現證據後才改 targets 的驗證狀態。DESIGN 是元件修改範圍；本 SDD 不新增產品功能、後端契約或依賴權限。來源 main `27a5dde13be6c7fcc057d3777558f61b1d06fa1f`；逐檔 SHA-256 與實際 targets 觀測見 [鎖定前基線](ROUND2-BASELINE.json)。

## 固定驗收條件

下表每列是一條獨立、編號固定的 AC，與第 1 輪 AC 分開：

- **Given**：該列 DESIGN 已確認，並核對最新程式與前置依賴；實作 issue／任務板已連回 T-0380。
- **When**：在所述範圍完成修改；執行 DESIGN 的修改項目驗證、相關原生 lint/typecheck/test/build、必要 isolated smoke／安全或互動回歸。
- **Then**：所有已決定修改有實作／證據對應；僅依實測才修的項目需附觀測結果，未見缺陷則記理由，不硬改。實際啟動／流程／退出清理通過，targets 與 runtime 相符且只在該列完整條件成立後 verified=true；證據與限制按 R2-AC-E 記錄。前置未滿足或必要驗證缺失時仍未完成，不因文件或 mock 成功改成 PASS。

| AC | 元件與權威 DESIGN | 本輪工作與必要界線 |
| --- | --- | --- |
| R2-AC-1 | [products/kith](../../products/kith/fe-review/DESIGN.md) | 沿用 worker/D1/seed/fake-provider；M1–M4 啟動器、流程、匿名／登入 targets、文件；不改 web/e2e/dev-bind。 |
| R2-AC-2 | [platform/dim-gate](../../platform/dim-gate/fe-review/DESIGN.md) | M1–M3 demo/base-path、persona×theme 專用 driver；實際 sessionStorage 身分及 UI 主題，不把 403 當預期畫面。 |
| R2-AC-3 | [products/hai-taskboard](../../products/hai-taskboard/fe-review/DESIGN.md) | 修改項目 1–4：ConnectedApp 真同源 runtime/session/admission；Fake 路徑與既有表單／狀態；healthz 或登入畫面不算 board 整合。私有 state 在 Git tree 外。 |
| R2-AC-4 | [platform/agent-platform](../../platform/agent-platform/fe-review/DESIGN.md) | M1–M3 真 PostgreSQL/FastAPI＋fake backend 互動 driver、pausing 中文與審批回饋；不改 backend/fixture/API；覆寫狀態與真整合分開。 |
| R2-AC-5 | [apps/cms-scaffold](../../apps/cms-scaffold/fe-review/DESIGN.md) | M1 僅驗證現有三 app，保持 verified=false；M2 僅在 W1/W2/W3/W3b/W4/W5 全部 VERIFIED 有證據後重建 routes/targets 並驗證。依賴未滿足時 AC 保持未完成。 |
| R2-AC-6 | [platform/ice-maker](../../platform/ice-maker/fe-review/DESIGN.md) | M1–M4 合成 extractor fixture、內嵌 UI／上傳輪詢狀態與結果可讀性；保留 escaping/MAX_HTML_BYTES，不改 API/SQLite/正式啟動。 |
| R2-AC-7 | [specs/fleet](../../specs/fleet/fe-review/DESIGN.md) | M1–M9 限已批准模板修正（viewport、table、focus、swap、rollback/empty）及 seed；不改 API/cookie/route，不新增產品畫面。 |
| R2-AC-8 | [systems/ojbquay](../../systems/ojbquay/fe-review/DESIGN.md) | M1–M4：先可審查的 loopback／所有權隔離方案，再真 stack/seed/auth、drawer/wizard 與 ResizeObserver。既有 Compose 不直接使用；若須改 backend/Compose，先另定範圍，不自行擴張。 |
| R2-AC-9 | [products/goku](../../products/goku/fe-review/DESIGN.md) | M1–M3 移除被追蹤 .env 並留無敏感範例；按鈕名稱/focus；錯誤與 empty/retry；合成 json-server，不加框架／依賴／主題。 |
| R2-AC-10 | [products/phark](../../products/phark/fe-review/DESIGN.md) | M1–M3 真 Spring/SQLite 與既有 API synthetic harness、Session/CSRF、窄版 deck 與表單；不直接改 DB/加 seed endpoint，不旁路 429。 |
| R2-AC-11 | [apps/flowshot](../../apps/flowshot/fe-review/DESIGN.md)＋[apps/loom](../../apps/loom/fe-review/DESIGN.md) | 配對交付：Flowshot M1–M2 shell 三態、Loom M1–M3 review-only preload/invoke/event/dispose；兩個隔離 namespace。只驗證 Web 模擬，不啟 native/Mac/真 vault/AI。 |
| R2-AC-12 | [gateways/pokercase](../../gateways/pokercase/fe-review/DESIGN.md) | M1–M4 Web 真合成登入與契約、loopback 假上游、TUI 兩尺寸三唯讀頁；金鑰遮罩。TUI 用 ANSI＋文字、專有 tmux，axe 對 TUI 不適用。 |
| R2-AC-13 | [systems/clarkq](../../systems/clarkq/fe-review/DESIGN.md) | M1–M3 單 Go 程序、env scrub/API seed、長資料/鍵盤、enqueue/peek/consume/clear；新 state/key，不用 demo Compose；公開 /ui 200 不算 API 登入成功。 |
| R2-AC-14 | [platform/fanzloud](../../platform/fanzloud/fe-review/DESIGN.md) | M1–M3 有限 HTTPS/WSS 合成 harness、狀態／操作／秘密回歸；fail-closed、取消不重送。mock 不等於真 backend/Cloud 驗收；真整合須另有明確範圍。 |

### R2-AC-E：證據、交付與狀態一致

**Given** 每個單位有修改與實跑結果；**When** 獨立審查／必要 CI 通過並正常合併；**Then** 各單位的任務報告明列 source commit、實際命令、環境／工具版本、結果、synthetic/mock/real wiring 邊界、owned cleanup、PR/CI/遠端回讀；REVIEW/PROMPT/targets 與交付一致。每個修改項目都有對應驗證，必要項不能用 skip 或檔名代替成功。未安裝 axe 不等於零違規；無對應 test script 的項目說明原生 gate 適用性，不虛構命令或默默加入依賴。

完成本卡要求所有列的 AC 和 R2-AC-E 通過；只交某切片仍 in_progress。verified=true 只是必要 metadata，不是充分的行為、內容、安全或 owner 驗收證據。TUI、Web/native 模擬與 mock 場景須按各 DESIGN 的適用範圍寫證據，不改稱產品整合通過。

## 執行與驗證方法

1. 依表順序一次啟動一個可執行單位；成對單位保留成對 PR。遇到依賴僅記錄並暫停該列，其他已在本卡內、無依賴的列可繼續；不偷偷開前置產品工程。每個技術任務先寫明 scope、修改項目→回歸案例、原生命令、成本估計與停止條件。
2. 行為變更先用最小測試重現，再實作；不能 test-first 時明記原因並補相稱回歸。只跑可增加證據的檢查。元件設計指定的實作 smoke 不等於第 3 輪完整 e2e 報告；本次不啟動第 3 輪。
3. 保持合成 state、每次新憑證、獨立 namespace、loopback、不用 host network／公開 ingress／既有秘密；安全限制比共用建議更嚴時從元件規則。HAI 類 state 在 Git tree 外；語言／套件快取仍用共用位置，不把 task state 與 SDK cache 混用。只清理可辨認的自有資源。
4. 修正舊「待確認」文字時引用第一輪既有批准；不重新要求同一決策，也不把真正未決事項改成已批准。實作前核對 DESIGN 所引原始碼；發現影響範圍的漂移先停該列並提出差異。
5. 不改 API/schema/共享套件/production認證，不升 major、不加 runtime dependency；已批准 DESIGN 明列的修改才可做。額外需求用具體提案取得批准。沒有 release/deploy/usable tag 或自動關閉 issue。
6. 每20分鐘主動工作 checkpoint；純建置/CI等待另計，精確拆分未知就寫 unknown。每個單位估時與有界重試在技術任務設定；沒有預設20分鐘硬停，也不把未完成單位當完成。

## 鎖定前實跑與基線

本次只進行文件／JSON 讀取，沒有啟動 UI 或修改產品。以該 checkout 的 `check_design.py` AC 清單定位元件，Python `json.loads` 讀取每份 targets，`hashlib.sha256` 記錄 DESIGN／targets，結果保存在 ROUND2-BASELINE.json。所有列的 targets 當時均為 false；runtime 的實際結果為 NOT_RUN。這證明尚未滿足第2輪的 metadata 條件，不假裝已測完行為 AC，也不把第一輪結構 PASS 當成第二輪成功。

重現靜態觀測（輸出目前值，exit0 只表示成功讀取，並非 AC 通過）：

```sh
python3 - <<'PYCODE'
import json
from pathlib import Path
b = json.loads(Path('docs/fe-review/ROUND2-BASELINE.json').read_text())
for unit in b['units']:
    for c in unit['components']:
        p = Path(c['component']) / 'fe-review/targets.json'
        print(unit['ac'], c['component'], json.loads(p.read_text())['verified'])
PYCODE
```

上表各 DESIGN 的「驗證」是後續執行時的具體正負向案例與命令；實作任務須落成固定測試／可重播 smoke，來源及結果記入 R2-AC-E。不能在此提案將未跑命令預填 PASS。

## 前置與例外的批准界線

- CMS M1 的交付明定 verified=false，不能以共用 Then 強迫改 true；只有 M2 依所列 v2 波次 VERIFIED 的實證完成後，R2-AC-5 才能 PASS。本次規格盤點未完成波次狀態稽核；歷史實跑紀錄不是所有波次已完成的證明。
- Ojbquay 先核對安全隔離方案；backend/Compose 若須修改不在此泛授權內。Fanzloud 的有限 mock 與真 backend/Cloud 分開，真整合需另定範圍。
- Flowshot/Loom 是各自 DESIGN 列明的 Web 驗證，不能當 native 完成；Pokercase TUI 用 terminal 證據。這些是證據適用性，不是降低必要條件。
- 此 SDD 只承接現有14單位，不重做CMS v2施工或引入D檔項目。
