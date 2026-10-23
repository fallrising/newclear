---
project: products/history-atlas
purpose: 以繁體中文互動地圖探索歷史年代、地點、人物與事件
kind: application
mainline: incomplete
usable_tag: none
reviewed: 2026-10-23
source_commit: a384d77a7e32f1dc35902eb94e7cf78daf68e367
---

# History Atlas 成功契約

## 主線與範圍

[SDD](SDD.md) 的 v1 產品主線是原生 JavaScript／SVG 歷史地理探索網站；先以有界且來源／權利已核對的資料包驗收核心流程，再逐步擴充內容。AC-01～AC-04 是本輪 M0 文件交付；AC-05～AC-18 是尚未實作的產品功能。不得用 M0 文件通過宣稱網站可用。

本輪只分析及寫 SDD，不匯入上游程式或資料、不新增後端或付費依賴、不部署／發 tag。具體目標、時間界線與任務狀態見 [任務板](docs/tasks/BOARD.md)。source_commit 表示讀取的 newclear 基準；本案尚無 runtime 版本。

## 驗收條件

以下文字與 SDD 相同；證據見 [文件驗證紀錄](docs/validation.md)。

| ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 固定上游 SHA 與可定位的程式／文件，When 完成功能與技術分析，Then 每項主要能力都有來源、限制與採用決策，歷史測試不冒充本輪重跑。 | passed | 文件審查及本輪 scoped／索引／AC 檢查通過；見驗證紀錄。 |
| AC-02 | Given owner 要求相同技術棧獨立重作，When 閱讀 SDD，Then 可依模組、資料、時間、搜尋、網址及 API 契約拆工，且文件、v1 主線、後續擴充範圍清楚分開。 | passed | 文件審查及本輪 scoped／索引／AC 檢查通過；見驗證紀錄。 |
| AC-03 | Given 新產品目錄，When 檢查 README、AGENTS、SUCCESS、任務板與根索引，Then 入口一致、AC 編號一致，mainline 為 incomplete、usable_tag 為 none。 | passed | 文件審查及本輪 scoped／索引／AC 檢查通過；見驗證紀錄。 |
| AC-04 | Given 本輪候選文件，When 執行官方 scoped checker、精確索引、連結、AC 對照與 staged whitespace 檢查並提交，Then 保留真實結果與未跑項，交付可回讀的 commit 和 Draft PR。 | pending | M0 文件已編寫，待本輪檢查／遠端交付結果。 |
| AC-05 | Given v1 靜態成品與資料包，When 在網站根及 /atlas/ 子路徑以 HTTP 開啟，Then 無需建置、登入、外部 API 或資料庫即可完成核心流程，主站無未宣告跨網域請求。 | pending | 尚未實作／未跑；規格見 SDD，不能以上游或合成測試替代產品驗收。 |
| AC-06 | Given 有明確覆蓋與不連續年份的資料包，When 選年、前後步進或播放，Then 依 yearOrdinal 與半開區間選快照，-1 下一年為 1，缺口顯示未收錄且不偷用最近疆域。 | pending | 尚未實作／未跑；規格見 SDD，不能以上游或合成測試替代產品驗收。 |
| AC-07 | Given 合法 Polygon／MultiPolygon、孔洞、點位與邊界案例，When 投影、反投影、縮放、命中與切換年份，Then 幾何及選取一致、孔洞不誤判、邊界回傳候選而不捏造唯一歸屬。 | pending | 尚未實作／未跑；規格見 SDD，不能以上游或合成測試替代產品驗收。 |
| AC-08 | Given 同時並立政權與可選圖層，When 切換圖例、前期對照或現代參考，Then 標籤、圖層和圖例一致，歷史與現代來源及時效清楚分別標示。 | pending | 尚未實作／未跑；規格見 SDD，不能以上游或合成測試替代產品驗收。 |
| AC-09 | Given 繁中、簡中、英文別名及跨年代同名資料，When 搜尋或以 URL／API 解析，Then 同一實體簡繁得到同 ID，同名回傳候選，過期名稱有說明，未知詞不猜座標。 | pending | 尚未實作／未跑；規格見 SDD，不能以上游或合成測試替代產品驗收。 |
| AC-10 | Given 有有效期與來源的地點沿革，When 選點或點擊地圖，Then 顯示按時序排序的名稱、行政隸屬與事件；無來源、無覆蓋及名義／實際管轄明確表達。 | pending | 尚未實作／未跑；規格見 SDD，不能以上游或合成測試替代產品驗收。 |
| AC-11 | Given 有並立政權年號與定位事件，When 選事件或顯示紀年，Then 使用所屬 regime 的年號，無法判定時只顯示公曆與原因，不用主朝年號誤套所有政權。 | pending | 尚未實作／未跑；規格見 SDD，不能以上游或合成測試替代產品驗收。 |
| AC-12 | Given 至少三位已校訂人物與每人四個有效站點，When 選人物、前後跳站或播放，Then 年份、事件、路線與選中站同步；快速切換不被較舊請求覆蓋。 | pending | 尚未實作／未跑；規格見 SDD，不能以上游或合成測試替代產品驗收。 |
| AC-13 | Given 同年及跨年自訂路線輸入，When 編解碼 URL 或選站，Then 同年一個年份可廣播、多年份必須逐站相配，無效或歧義在變更畫面前拒絕，重開連結還原同一語義狀態。 | pending | 尚未實作／未跑；規格見 SDD，不能以上游或合成測試替代產品驗收。 |
| AC-14 | Given 至少十個合法題目及固定 seed，When 完成十題定位測驗，Then 先放針確認、每題只計分一次，以 WGS84 大圓距離及規定公式計分，重新開始清除舊狀態，鍵盤也可完成。 | pending | 尚未實作／未跑；規格見 SDD，不能以上游或合成測試替代產品驗收。 |
| AC-15 | Given v1 API 與 CLI 契約，When API 查詢已載入資料或 CLI 產生連結，Then API 回版本、revision、狀態與來源 ID 且 inspect 不改畫面、locate 座標可用 URL 重現；CLI 僅回語法合法的 URL 與穩定退出碼，不冒稱資料及來源已驗證。 | pending | 尚未實作／未跑；規格見 SDD，不能以上游或合成測試替代產品驗收。 |
| AC-16 | Given 每筆史實／幾何／素材及來源台帳，When 建立公開資料包，Then 全部可追溯且再散布與衍作審核均通過，未知權利資料不進產物，合成測試與歷史資料不混用。 | pending | 尚未實作／未跑；規格見 SDD，不能以上游或合成測試替代產品驗收。 |
| AC-17 | Given 360px 行動視窗、鍵盤及 reduced-motion 使用者，When 操作時間軸、搜尋、卡片、路線和測驗，Then 無阻斷的橫向溢出、焦點可回復、主要觸控區至少 44px、減少動態偏好有效。 | pending | 尚未實作／未跑；規格見 SDD，不能以上游或合成測試替代產品驗收。 |
| AC-18 | Given 固定資料 revision、瀏覽器版本與量測環境，When 跑資料驗證、失敗載入、快切年份與效能量測，Then 結構／參照／來源檢查通過，舊請求不覆蓋新狀態，實測指標與未達目標如實留存。 | pending | 尚未實作／未跑；規格見 SDD，不能以上游或合成測試替代產品驗收。 |

## 現況與缺口

M0 新增分析與設計文件，等待驗證及 owner 審閱。沒有 index.html、應用程式、正式史料包或瀏覽器 runtime 證據。v1 內容來源和具體時段仍需資料工作確認；18 個歷史時期等上游內容規模不算本案已取得資料。

## 啟動與驗證

目前沒有網站啟動指令。可從 repo 根執行官方文件檢查：

```sh
python3 scripts/check_project_success.py --projects products/history-atlas
```

完整 checkout 的根索引／全庫檢查使用 `python3 scripts/check_project_success.py`；本輪部分本機快照只會聲稱 scoped 驗證與官方 index_text 的精確索引比對。候選文件還需 staged whitespace、Markdown 連結及 AC 一致性檢查。實際結果與環境限制記在驗證紀錄。

## 可用版本

`usable_tag: none`。mainline 保持 incomplete；M0 合併不會建立 usable tag。產品主線全部通過、必要 CI／審查及合併完成後，再依根規範與 owner 授權處理。
