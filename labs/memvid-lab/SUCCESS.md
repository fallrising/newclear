---
project: labs/memvid-lab
purpose: 以真實固定版本 Memvid 實跑官方記憶場景與文字、PDF、影像和語音能力
kind: lab
mainline: complete
usable_tag: none
reviewed: 2026-10-29
source_commit: 67132cd45bcd4e53fb61d4a1f6b650408f34e2e8
---

# Memvid lab 成功契約

## 主線與範圍

依 [SDD](SDD.md) 實跑官方 11 類 use case 的記憶層及 basic／PDF／CLIP／Whisper 範例涉及的能力。
包含真實 SDK、文字語意搜尋、持久化、來源與時間線、離線與單檔搬移驗證。
不包含完整企業產品、LLM 生成回答、付費 API、production 部署或上游效能宣稱。

## 驗收條件

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 固定 upstream SHA 與 SDK，When 核對 README／API／examples，Then 11 類場景及具名範例各有實作、限制與來源對照。 | passed | [固定來源／能力矩陣](docs/upstream.md)、[場景與適配](README.md)，版本與限制已記錄。 |
| AC-02 | Given 11 類合成案例，When 執行真實 Memvid 建檔、寫入與檢索，Then 每類正確命中來源及內容；長期 agent 以新程序讀回舊記憶。 | passed | [full-run.json](docs/evidence/full-run.json)：UC-01～11 全過；詞彙索引重建與 ask guard 明示。 |
| AC-03 | Given 本地文字模型與詞彙不同的查詢，When 執行向量／混合搜尋，Then 預先指定的相關內容命中且記錄真實模型來源。 | passed | [執行紀錄](docs/evidence/README.md)：CAP-SEMANTIC：兩組詞彙不同 query 的 lexical 對照為 0 hits，真 BGE／Memvid 向量命中及 mixed／reopen passed。 |
| AC-04 | Given 同一文件的新舊內容與時間線，When 追加／更新並查詢，Then 核對現況與保留歷史；可用的 audit 行為與不支援的 replay 語意分開記錄。 | passed | [執行紀錄](docs/evidence/README.md)：UC-06／08／10：current frame、新舊內容、as-of、timeline、session 持久化與 FIND replay passed。 |
| AC-05 | Given 可讀文字 PDF fixture，When 用真實 SDK ingestion，Then 搜尋命中從 PDF 擷取的文字及來源，空結果不可 pass。 | passed | [執行紀錄](docs/evidence/README.md)：CAP-PDF：真 PDF→SDK extraction→文字／URI 檢索→reopen passed；extractous AWT fallback 限制保留。 |
| AC-06 | Given 有明確不同內容的圖片與文字 query，When 真實本地 CLIP encode 及向量搜尋，Then 正確圖片命中；不用隨機向量／檔名替代。 | passed | [執行紀錄](docs/evidence/README.md)：CAP-CLIP：真 image/text encoder、兩種圖片語意命中、lexical 0 hit 對照及 reopen passed。 |
| AC-07 | Given 已知內容的音訊，When 真實本地 Whisper 轉錄及 Memvid 檢索，Then 轉錄含預期詞彙且可檢索；不注入參考稿。 | passed | [執行紀錄](docs/evidence/README.md)：CAP-WHISPER：明示 cache patch 的真 native 轉錄→SDK 入庫→查詢／reopen passed，六項 native 負例。 |
| AC-08 | Given 已準備依賴與新輸出目錄，When 禁止外網執行、搬移單檔及無命中／既有目錄負例，Then 可讀回正確內容、拒絕覆寫，未通過項目有非零結果與報告。 | passed | [執行紀錄](docs/evidence/README.md)：完整 runtime 在 seccomp 下 15 passed；UC-01／03 新程序與搬移、八項 CLI regression 全過。 |

## 本次計畫

Owner 直接指示，T-0001／Session `Memvid-20261028`。先記錄本合約及 [任務板](docs/tasks/BOARD.md)，再以真實依賴實作並執行；獨立 reviewer 檢查 oracle、證據與可重現性。
原實驗已完成 [PR #709](https://github.com/fallrising/newclear/pull/709) 與 [結案 #733](https://github.com/fallrising/newclear/pull/733)。
2026-10-29 owner 批准的後續需求 [T-0436](https://github.com/fallrising/desk/tree/main/tasks/T-0436-memvid-notes-usability) 依 [繁中筆記評估規格](docs/notes-usability.md) 另行驗收，不重開或擴張 AC-01～08。

## 現況與缺口

全部八項 AC 已取得本機實跑證據：15 個場景及八項 CLI 邊界通過。Runtime 的 15 個 source／lock hash 已與報告核對。
`mainline: complete` 僅指原場景實驗：已合併、四項 CI success、兩份獨立審查 ACCEPT；未聲稱產品化或正式部署。
2026-10-29 回讀確認：驗證 head `67132cd45bcd4e53fb61d4a1f6b650408f34e2e8` 到本次 base 的元件差異只有任務板，runtime／lock／workflow 未變，沿用既有實跑證據。後續繁中筆記評估仍待執行，見獨立規格與任務板。
原始 SDK 的詞彙索引漏失、ask 擴大 context、中文／底線符號查詢，以及 Whisper cache 限制詳列於 [README](README.md) 與 [原始／最終證據](docs/evidence/README.md)。
本次成功指明示適配後的有界實驗，不宣稱所有 upstream 原始路徑已無缺陷。

## 啟動與驗證

[README](README.md) 提供 `make setup`、`make prepare`、`make check`、`make full`；core profile 可不準備模型先驗證 12 項。
共用 gate：`python3 scripts/check_indexes.py`、`python3 .github/scripts/check_workflows.py`；元件 CI 已接線至根目錄 workflow。

## 可用版本

`usable_tag: none`。原場景實驗完成與可用版本發布分開；owner 本輪授權程式／文件的 commit、PR 與合併，沒有授權 release／usable tag 或部署。
