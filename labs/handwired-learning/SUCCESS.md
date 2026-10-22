---
project: labs/handwired-learning
purpose: 用一頁溫度校正對照，讓初學者看懂固定數值圖與用梯度調整係數的差別
kind: lab
mainline: incomplete
usable_tag: none
reviewed: 2026-10-22
source_commit: 5d44cf296d5c4af7bcbcbd926688802e1812bce3
---

# handwired-learning 成功契約

## 主線與範圍

主線是 [SDD](docs/SDD.md) 的 MVP（HW-0～HW-3）：核對固定上游版本的 CPU 與梯度入口，
做出 `y = a × x + b` 的前向對照與係數學習單頁，並讓 1–2 位初學者試用。
非目標：GPU、通用框架、任意 JavaScript 編譯、效能宣稱。

## 驗收條件

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 固定上游 SHA，When 核對 builder、CPU evaluator 與梯度入口，Then 產出支援表與一個最小可執行範例；沒有梯度 API 時明確記錄並改用解析梯度。 | passed | HW-0：[API 支援表](docs/upstream-api.md)、[實際驗證報告](tasks/450-hw0/report.md)；固定版本 CPU 與通用 backward 5 tests 通過。 |
| AC-02 | Given 合法與不合法輸入，When 執行前向對照，Then 合法點在容許值內、不合法輸入在圖執行前被拒絕（SDD HW-A01、A02）。 | passed | [HW-1 報告](tasks/459-hw1/report.md)：真實固定 CPU、輸入拒絕、離線產物與 Chromium 互動驗證；最終交付狀態以 PR #460 為準。 |
| AC-03 | Given 9 個固定訓練點與初始 a=1、b=0，When 學習率 0.05 跑 500 步、以及學習率 2.0，Then 前者最大誤差 ≤ 0.05 °C、後者顯示停止原因（SDD HW-A03～A05）。 | pending | 尚未實作（HW-2）；收斂只在紙上估算過。 |
| AC-04 | Given 1–2 位未學過 autodiff 的開發者，When 試用頁面，Then 能說出 builder 與 runtime 的差別及「loss 下降不等於一般智能」。 | pending | 尚未試用（HW-3）。 |

## 本次 HW-2 計畫

Session `Handwired-20261022-0411`，Refs #465；只交付 AC-03 / HW-A03～A05。沿用真正固定 Handwired CPU／backward，不新增依賴；先寫梯度、500 步收斂與失敗停止測試並觀察 RED，再於同一離線頁加入學習、單步、跑到 500、重設及學習率 2.0 示範。前向驗證與允差保持不變，HW-3 真人試用維持 pending。主控重跑 Node／真實瀏覽器及 repo gates；最終 head CI 與不同家族唯讀審查通過且同步 main 才合併。進度見 [任務板](docs/tasks/BOARD.md)。

## 前次 HW-1 計畫

Session `Handwired-20261021-1845`，Refs #459；僅交付 AC-02。先以固定上游真實 CPU 圖測試 HW-A01/A02（含拒絕無效輸入先於執行），再實作可直接本機開啟的靜態前向對照頁。使用 Node 24 內建 TypeScript stripping 產生自包含 HTML，保留 MIT 聲明、不新增套件；驗證建置、互動、既有 API 及 repo gates。HW-2/HW-3 維持 pending。

2026-10-22 owner 指示接手：`Handwired-20261021-1844` 保存原 worktree 快照並完成同一 issue／PR。整合 main 時發現 Kith 同名任務，Handwired 改編號為 T-901／T-902，保留兩方紀錄。

## 前次 HW-0 計畫

Session `Handwired-20261021-1808`，Refs #450；僅交付 AC-01。核對固定 SHA、MIT 授權、CPU 與梯度入口，先寫最小範例測試並觀察失敗，再執行真實上游 CPU 範例及 repo validators。HW-1～HW-3 不在本次範圍，AC-01 已取得下列本機證據；AC-02～04 維持 pending。

## 現況與缺口

HW-0 已執行固定版本的 CPU 與參數梯度範例。上游來源保存在 repo 外，沒有 vendoring 或安裝依賴。HW-1 前向網頁已實作並通過本機測試；HW-2 學習區與 HW-3 真人試用仍待交付，主線保持 incomplete。

## 啟動與驗證

依 [API 支援表](docs/upstream-api.md) 下載固定來源並設定 `HANDWIRED_ROOT`，執行：

```sh
node labs/handwired-learning/examples/api-probe.mjs
node --test --test-isolation=none labs/handwired-learning/tests/api-probe.test.mjs
```

Node v24.14.0 已驗證，無 npm 安裝。上述命令保留 HW-0 API probe；HW-1 的單一離線 HTML 建置與完整測試見 [README](README.md) 及 [報告](tasks/459-hw1/report.md)。

## 可用版本

`usable_tag: none`。AC-01～AC-04 全部通過前，不建立 usable tag。
