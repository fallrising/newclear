---
project: labs/handwired-learning
purpose: 用一頁溫度校正對照，讓初學者看懂固定數值圖與用梯度調整係數的差別
kind: lab
mainline: incomplete
usable_tag: none
reviewed: 2026-10-22
source_commit: 222c1a8a736dbb3ac89f34345a7bc73fa887aba8
---

# handwired-learning 成功契約

## 主線與範圍

主線是 [SDD](docs/SDD.md) 的 MVP（HW-0～HW-3）：核對固定上游版本的 CPU 與梯度入口，
做出 `y = a × x + b` 的前向對照與係數學習單頁，並讓 1–2 位初學者試用。
非目標：GPU、通用框架、任意 JavaScript 編譯、效能宣稱。

## 驗收條件

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 固定上游 SHA，When 核對 builder、CPU evaluator 與梯度入口，Then 產出支援表與一個最小可執行範例；沒有梯度 API 時明確記錄並改用解析梯度。 | pending | 尚未核對（HW-0）。上游文件只確認 `Circuit` 與 CPU 路徑。 |
| AC-02 | Given 合法與不合法輸入，When 執行前向對照，Then 合法點在容許值內、不合法輸入在圖執行前被拒絕（SDD HW-A01、A02）。 | pending | 尚未實作（HW-1）。 |
| AC-03 | Given 9 個固定訓練點與初始 a=1、b=0，When 學習率 0.05 跑 500 步、以及學習率 2.0，Then 前者最大誤差 ≤ 0.05 °C、後者顯示停止原因（SDD HW-A03～A05）。 | pending | 尚未實作（HW-2）；收斂只在紙上估算過。 |
| AC-04 | Given 1–2 位未學過 autodiff 的開發者，When 試用頁面，Then 能說出 builder 與 runtime 的差別及「loss 下降不等於一般智能」。 | pending | 尚未試用（HW-3）。 |

## 現況與缺口

只有設計文件；沒有複製上游程式、安裝依賴或執行任何範例。

## 啟動與驗證

目前沒有可啟動的命令。實作後的開啟方式與測試命令寫回本節。

## 可用版本

`usable_tag: none`。AC-01～AC-04 全部通過前，不建立 usable tag。
