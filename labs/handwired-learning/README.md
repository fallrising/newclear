# Handwired Learning

> 主線、驗收條件、剩餘缺口與可用版本：[SUCCESS.md](SUCCESS.md)。

> 狀態：**Proposed／僅學習設計，尚未實作或執行**。投入與文檔檔位未分級。

用一個小型數值公式，對照普通 JavaScript 與 Handwired 的 FP32 圖，理解「寫出運算」與「調整參數」的差別。目標是讓初學者看懂輸入、每一步計算、誤差與梯度，不建立新的通用框架。

[SDD](docs/SDD.md) 定義 MVP：先核對上游 API，再做溫度校正的前向對照與係數學習單頁。CPU 是第一個候選執行路徑；沒有 GPU 效能承諾。

Handwired 的 JavaScript builder 建立固定數值圖，並非任意 JavaScript 編譯器。這也不是 LLM 自我訓練或自動取得任意能力。上游來源固定為 [chenglou/handwired](https://github.com/chenglou/handwired/tree/257856e3b221140acb4cc4460626b850c0bd4ff1)。本 lab 尚未複製源碼、安裝依賴、測量或提供可執行教程。
