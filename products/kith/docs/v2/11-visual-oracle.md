# 11 — 本地像素回歸 gate（#387）

[測試入口](08-testing-e2e.md) · [決策 D-16](10-decisions.md) · [成功契約](../../SUCCESS.md) · [任務／證據](../../tasks/387-visual-oracle/report.md)

W7 已 VERIFIED；本工作補 D-16 延期的第一組 pixel oracle。這是工程回歸 baseline，不表示 owner 已驗收整體產品視覺。既有 W0–W7 截圖仍是歷史證據，沒有變成已批准 pixel baseline。根 CI 仍只有既有 test/web；本地通過不表示有自動 CI pixel protection，也不恢復已移除的 hosted E2E job。

## 場景與判定

| ID | 固定狀態／主體 | PNG 尺寸 |
| --- | --- | --- |
| E2E-VIS-01 | `/login`，空帳密、disabled submit；整個 `login-page` | 1280×800 |
| E2E-VIS-02 | 真實 UI 登入合成 operator Ada，`/` 的 `home-empty` greeting 與兩張引導卡 | 1008×800 |
| E2E-VIS-03 | 真實 UI 登入後 `/console/people` 的 `people-list`；Ada、Ben、Chen、disabled Dora 四列 | 736×256 |

實際 viewport 都是 1280×800、DPR1；後兩張是 locator crop，沒有宣稱覆蓋 sidebar／整個控制台。選取既有 seed/auth/backend，不 stub UI 或改產品行為。等可見狀態、空欄位／四名成員與 `document.fonts.ready`；不加任意 sleep，不 mask 主體。Playwright 內部連續截圖穩定化不取代語義斷言。`threshold: 0`、`maxDiffPixels: 0`；動畫停用、caret 隱藏。精確語義：此版 Playwright 使用 Pixelmatch，保留預設 `includeAA=false`，因此「零差異」是**零個計入的不同像素**，不計被 Pixelmatch 分類為 anti-aliasing 的像素；不是逐 RGBA／PNG bytes 相同保證。PNG SHA256 用於 baseline 來源與證據完整性，不額外當 pixel oracle；encoding-only 差異不是視覺回歸。三個場景不含時間戳或未讀 badge，故不凍結 server clock。

環境固定 Node24.18.0、Playwright1.56.1、Chromium1194（141.0.7390.37）、Linux x86_64、Ubuntu24.04.4 LTS，image：

```text
mcr.microsoft.com/playwright@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e
```

字型是 bundled `@fontsource-variable/figtree`5.3.0 加 image 的實際系統 CJK fallback **WenQuanYi Zen Hei Regular**（`fc-match :lang=zh-tw`）。CSS 的 Noto Sans TC 名稱不代表已安裝。完整 fontconfig 清單及48個字型檔 SHA256 在 [fonts.txt](../../e2e/visual-baselines/fonts.txt)、[font-files.json](../../e2e/visual-baselines/font-files.json)；PNG、seed、lock 與環境摘要在 [metadata.json](../../e2e/visual-baselines/metadata.json)。更換 image／browser／font 不調高 tolerance；先建新候選並獨立審查。

## 可重跑命令

工作目錄 `products/kith`。需要 Linux x86_64、Python3.11+（支援 tar extraction data filter）、Docker daemon、shared workspace launcher；第一次 provision 需要被授權的 npm/CDN/registry 網路。無全域安裝、無 HOME／CODEX_HOME override；不掛主機 credentials 或服務 socket進容器。

將 `WORKSPACE_LAUNCHER` 指向現有 `agent-workspace/workspace.py`。每個 job 使用新的 task ID；輸出在該 launcher task 的 build/cache/preserve 中。以下 `RUNTIME` 必須填 provision 最後輸出的絕對 task 路徑，非原始碼目錄：

```sh
python3 "$WORKSPACE_LAUNCHER" run kith visual-runtime-1 -- python3 e2e/scripts/run-visual.py provision
RUNTIME=/absolute/launcher/data/projects/kith/tasks/visual-runtime-1
python3 "$WORKSPACE_LAUNCHER" run kith visual-check-1 -- python3 e2e/scripts/run-visual.py check --runtime "$RUNTIME"
python3 "$WORKSPACE_LAUNCHER" run kith visual-probe-1 -- python3 e2e/scripts/run-visual.py probe --runtime "$RUNTIME"
python3 "$WORKSPACE_LAUNCHER" run kith visual-full-1 -- python3 e2e/scripts/run-visual.py suite --runtime "$RUNTIME"
```

`provision` 驗證寫死的官方 Node archive SHA256 `55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742`，三組既有 lock 執行 `npm ci`，下載 Playwright1194 並拉取 image exact digest。它不升級依賴／寫新 lock。每次執行核對 runtime receipt 與目前 lock hash。`check` 沒有轉傳任意 Playwright CLI、也沒有 update 模式；失敗時不能自動建立／改寫 tracked baseline。`probe` 只在 browser 的 login 主體加12px洋紅 border，預期非零退出且錯誤是 pixel mismatch。`suite` 跑原有 `npm run e2e:all`；需要 bounded 開發驗證時可加 `--focus evidence|network|harness|chat`（固定 grep，不能注入其他 CLI），保留既有 tags／mobile／故障 gates；visual 三項只由 dedicated config 登記，沒有偷偷加進普通 E2E 或產生 missing baseline。

執行容器 `--network none`，沒有 host network／對外 ports；本地 fake-provider、Wrangler、browser 共用自己的 loopback。visual context 另拒絕所有非本 run origin 的 browser request，service worker 關閉。來源 readonly；每次 fresh migration/seed/state，build/dist/report/temp/config 在 owned task。Wrangler 的 `.wrangler` 只連到本 job 的 `AGENT_BUILD_DIR/wrangler`；三組 `node_modules` 連到 pinned runtime（僅 dependency/Vite temp cache 可重用）。既有非本 job/runtime 的路徑會拒絕，不覆蓋；finally 只移除這次建立的 links。若已有正式 dependency 目錄，請使用乾淨 checkout，勿刪既有 state。容器不會因 flag 宣告而取得網路隔離，實際隔離來自 Docker network namespace。

Docker `--network none` 的 Chromium 原生 `navigator.onLine` 是 false，雖然 loopback HTTP/WS 仍可用。helper 才啟用 `KITH_E2E_LOOPBACK_ONLINE=1`：worker browser fixture 在每個返回的 page 上先完成 CDP `Network.emulateNetworkConditions(offline:false)`，只校正 loopback 可達的 connectivity signal；沒有換 navigator getter。`context.setOffline(true)`、其後開的新 tab、明確 `newContext({offline:true})` 及 false→true 切換仍保留 native 語義，`E2E-W0-04` 同時驗證 HTTP/WS 與 offline fetch rejection。不經 helper 的既有預設 fixture 不啟用此調整。nested probe 只繼承明列的 external build 路徑及此 connectivity opt-in，其他 per-run identity/state 仍重設；`E2E-W0-02` 回讀 nested manifest 驗證實際 `navigator.onLine=true`。runtime-wide lock 防止重用同一 runtime 的並行 jobs 刪除對方 links。

## 候選、批准與更新

候選建立是有意改基準的獨立操作，只能寫到這次 `AGENT_ARTIFACTS_DIR` 下尚不存在的絕對目錄。例如以 launcher `-- bash -c` 展開本次變數：

```sh
python3 "$WORKSPACE_LAUNCHER" run kith visual-candidate-1 -- bash -c 'python3 e2e/scripts/run-visual.py candidate --runtime "$1" --candidate-dir "$AGENT_ARTIFACTS_DIR/candidates"' bash "$RUNTIME"
```

候選圖不是通過證明。先由獨立 reviewer 對照 [07 視覺設計](07-visual-design.md) 與預期狀態檢圖，記錄 crop 範圍、PNG尺寸、hash、source／dirty diff／seed／環境及審查結論；再明確把三張批准圖及 metadata 納入版本控制。不可拿 mismatch 的 actual 無條件覆蓋 expected。每次更新都保留一個可見變異造成真正 mismatch RED（不是缺 baseline/browser/login），移除變異後至少三個 fresh container／seed GREEN，baseline SHA256 全程不變。

這次獨立工程檢圖批准的 PNG hash 與證據在 metadata/report；根 CI 的新 lane 需要另立 scope，固定同一 image、Node、browser、字型、Docker／artifact policy，並由 owner 決定 runner 與成本。沒有改 root workflow，沒有宣稱目前 CI 阻擋 visual regression。

## 證據契約與故障方式

只新增 `E2E-VIS-01`–`03`；`99` 等未知 ID 仍拒絕。GREEN 保留 `files/<id>/current.png`；真正 mismatch 的原生附件複製為 `visual-expected`／`visual-actual`／`visual-diff`，使用 typed schema，manifest 記錄 path/bytes/SHA256。actual/diff 只可來自該 run `test-output`；expected 限該輸出或三個既定 baseline 路徑，PNG signature／10MiB 邊界驗證，不接受任意外部檔案。保留原有 missing evidence fail closed 與 redaction scanner。

`E2E-W0-03` 使用獨立子目錄直接驗證 reporter 成功、未知 VIS ID、schema ID、missing evidence、越界 attachment、失敗比較缺少 diff 的不完整 bundle，檢查三種 PNG role 和 bytes/hash；既有 `E2E-W0-02` 巢狀 good/leak/missing/collision 測試不改。主體 CSS 變異則驗證實際 pixel comparator 與完整差異證據鏈，不能由 dummy PNG 的 reporter 測試替代。
