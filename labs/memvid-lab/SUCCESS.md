---
project: labs/memvid-lab
purpose: 以真實固定版本 Memvid 實跑官方記憶場景與文字、PDF、影像和語音能力
kind: lab
mainline: incomplete
usable_tag: none
reviewed: 2026-10-28
source_commit: f16dc2bb825ab1c85e5a68416aa46e80c58902b4
---

# Memvid lab 成功契約

## 主線與範圍

依 [SDD](SDD.md) 實跑官方 11 類 use case 的記憶層及 basic／PDF／CLIP／Whisper 範例涉及的能力。
包含真實 SDK、文字語意搜尋、持久化、來源與時間線、離線與單檔搬移驗證。
不包含完整企業產品、LLM 生成回答、付費 API、production 部署或上游效能宣稱。

## 驗收條件

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 固定 upstream SHA 與 SDK，When 核對 README／API／examples，Then 11 類場景及具名範例各有實作、限制與來源對照。 | pending | 已啟動上游與 SDK 探勘。 |
| AC-02 | Given 11 類合成案例，When 執行真實 Memvid 建檔、寫入與檢索，Then 每類正確命中來源及內容；長期 agent 以新程序讀回舊記憶。 | pending | 尚未實作。 |
| AC-03 | Given 本地文字模型與詞彙不同的查詢，When 執行向量／混合搜尋，Then 預先指定的相關內容命中且記錄真實模型來源。 | pending | 尚未執行。 |
| AC-04 | Given 同一文件的新舊內容與時間線，When 追加／更新並查詢，Then 核對現況與保留歷史；可用的 audit 行為與不支援的 replay 語意分開記錄。 | pending | 尚未執行。 |
| AC-05 | Given 可讀文字 PDF fixture，When 用真實 SDK ingestion，Then 搜尋命中從 PDF 擷取的文字及來源，空結果不可 pass。 | pending | 尚未執行。 |
| AC-06 | Given 有明確不同內容的圖片與文字 query，When 真實本地 CLIP encode 及向量搜尋，Then 正確圖片命中；不用隨機向量／檔名替代。 | pending | 尚未執行。 |
| AC-07 | Given 已知內容的音訊，When 真實本地 Whisper 轉錄及 Memvid 檢索，Then 轉錄含預期詞彙且可檢索；不注入參考稿。 | pending | 尚未執行。 |
| AC-08 | Given 已準備依賴與新輸出目錄，When 禁止外網執行、搬移單檔及無命中／既有目錄負例，Then 可讀回正確內容、拒絕覆寫，未通過項目有非零結果與報告。 | pending | 尚未執行。 |

## 本次計畫

Owner 直接指示，T-0001／Session `Memvid-20261028`。先記錄本合約及 [任務板](docs/tasks/BOARD.md)，再以真實依賴實作並執行；獨立 reviewer 檢查 oracle、證據與可重現性。
本次保持 Draft PR，未合併前任務不標 done。

## 現況與缺口

目前已讀 repo 合約與上游入口，SDK probe 進行中；全部 runtime AC 待證據。
實作或環境若有缺口，逐項保留，不縮減原範圍換取完成。

## 啟動與驗證

實作完成後由 [README](README.md) 提供固定版本安裝、模型準備與單一執行入口。
共用 gate：`python3 scripts/check_indexes.py`。元件 runtime 及新增 workflow gate 待接線。

## 可用版本

`usable_tag: none`。本次只交付 Draft PR；所有必要 AC、審查、CI 與合併前，不宣稱主線完成或發布 tag。
