---
project: tools/streaming-converter
purpose: 保留 FFmpeg 多畫質 HLS 轉檔與網頁播放的歷史工具
kind: archived
mainline: not-applicable
usable_tag: none
reviewed: 2026-10-21
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# streaming-converter 成功契約

## 主線與範圍

[README](README.md) 已列Tier D retired；保存Bash/FFmpeg管線、設定與播放器是結束條件。
原使用情境為驗證輸入影片→轉HLS variants/master→選用上傳→網頁播放。
README的「complete solution」是歷史介紹，不是本次驗收結論。
不恢復產品維護、不接R2或Nginx部署、不將任意舊影片／輸出目錄當測試資料。
`not-applicable`描述封存主線，並不宣稱播放與轉檔已驗收。

## 驗收條件

passed 僅表示本次已核對的靜態條件；historical 是已有紀錄，並非本次重跑。
產品未驗項與後續失敗均保留；文件格式通過不能代替runtime驗收。

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 封存工具，When 查歷史入口，Then conversion／validation／control與播放器原始碼仍可定位。 | passed | [scripts](scripts/)、[www](www/)、[README](README.md)。 |
| AC-02 | Given 管線source，When 核對輸入失敗及R2選項，Then 有failed marker及可選上傳分支的歷史邏輯。 | passed | [control.sh](scripts/control.sh)、[upload.sh](scripts/upload.sh)；僅靜態核對，不是執行結果。 |
| AC-03 | Given 固定合法影片與工具鏈，When 轉出多畫質HLS再播放，Then playlist／segment有效且畫面／聲音正常。 | pending | 缺對應目前來源的FFmpeg／播放器端到端證據；封存不在本次補跑。 |

## 現況與缺口

已有實際shell管線、segment calculator及web player，非純概念設計。
[config.sh](scripts/config.sh) 決定資料位置與選用外部儲存，應先核對後再考古執行。
failed marker會影響重跑；cleanup可刪資料，不能當無副作用檢查。
舊依賴版本、Nginx設定及R2整合未重驗。
封存保存來源及未完成證據，不能用README形容詞補足runtime結果。

上傳失敗時local檔案可能仍存在；本地成功與遠端可播放須分別驗收。
轉檔、watch及cleanup的資料副作用需逐項核對，不直接套用舊預設路徑。

## 啟動與驗證

歷史使用入口依 [README](README.md) 與 [control.sh](scripts/control.sh)。
[convert.sh](scripts/convert.sh)、[validate.sh](scripts/validate.sh) 是FFmpeg管線，
[init.sh](init.sh) 為原初始化腳本，需先閱讀其目錄與寫入行為。
僅需靜態核對時可選Bash語法檢查；本次不執行轉檔／cleanup／upload／服務安裝。
若重新驗證，須使用owned臨時輸入輸出並記錄FFmpeg與播放器版本。

本次只核對文件、程式入口與既有證據；未執行產品建置或外部整合。
歷史命令與結果保留原來源，不以文件盤點日期覆蓋實測日期。

## 可用版本

目前 `usable_tag: none`。
封存工具不建立可用標記。
若owner重啟，需先限定工具鏈、輸入格式及本地／外部儲存範圍，再補HLS轉檔播放與失敗回復證據。

標記前須核對已合併目標SHA、必要CI／審查與核心流程證據。
沿用較早結果須比較其後程式及設定差異，相關變更必須補驗。
