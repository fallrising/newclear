---
project: tools/motion-prompt
purpose: 以繁中與英文動態示範辨認術語並複製 AI 提示詞
kind: tool
mainline: incomplete
usable_tag: none
reviewed: 2026-10-28
source_commit: f16dc2bb825ab1c85e5a68416aa46e80c58902b4
---

# Motion Prompt 成功契約

## 主線與範圍

[SDD](SDD.md) 為待批准的完整需求與固定 AC；本 PR 僅建立規格入口，網站尚未整合至此分支。範圍是 5 packs／120 項完整雙語靜態圖鑑，不新增後端、追蹤、付費服務、Skill／CLI 或大型框架；文檔檔位未分級。

## 驗收條件

所有候選整合驗收維持 pending；[歷史基準](docs/evidence/baseline.md) 不冒充本次通過。

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 固定上游 SHA 與來源 manifest；When 比對全部項目；Then 5 packs 各 24 項、共 120 項的 ID、slug、英文名稱及分類與來源完全一致。 | pending | [SDD AC-01](SDD.md#ac-01-固定來源與完整匯入)；待批准及最新整合驗證。 |
| AC-02 | Given 任一項目；When 讀取 zh-Hant／en；Then 名稱、意思、用途、AI 例句、動作／視覺規格、可複製提示詞皆完整，缺繁中必須使建置失敗，不得靜默 fallback。 | pending | [SDD AC-02](SDD.md#ac-02-完整雙語內容)；待批准及最新整合驗證。 |
| AC-03 | Given 英日來源與 Canvas；When 核對翻譯；Then ID／slug 不重編，612 條規格的數值、單位、條目順序、方向及動作語意一致；dolly 與 zoom 不混淆。 | pending | [SDD AC-03](SDD.md#ac-03-翻譯與規格忠實度)；待批准及最新整合驗證。 |
| AC-04 | Given 首次開啟與已輸入搜尋、備註、選取；When 切換介面語言；Then 預設繁中並顯示繁中＋英文術語，英文模式無繁中解釋；狀態保留，導覽／錯誤／空結果／ARIA／畫布有意義標籤均本地化。 | pending | [SDD AC-04](SDD.md#ac-04-介面語言與狀態)；待批准及最新整合驗證。 |
| AC-05 | Given 全部資料；When 搜尋繁中、英文、關鍵字、#005／005／5 並依 pack／分類篩選；Then 正確匹配、數量更新且無結果狀態可理解。 | pending | [SDD AC-05](SDD.md#ac-05-尋找效果)；待批准及最新整合驗證。 |
| AC-06 | Given 單項 ID 或分享選取連結；When 直接開啟、重新整理或鍵盤切換項目；Then 顯示正確效果與規格，詳情可關閉並恢復焦點。 | pending | [SDD AC-06](SDD.md#ac-06-詳情與深連結)；待批准及最新整合驗證。 |
| AC-07 | Given 單項與跨 pack 多選及使用者備註；When 分別選繁中／英文複製；Then 真實剪貼簿含所選語言的完整規格與備註，無須切換介面，清除與分享選取可用。 | pending | [SDD AC-07](SDD.md#ac-07-獨立提示詞語言)；待批准及最新整合驗證。 |
| AC-08 | Given 每項兩語示範；When 播放並在至少 8 個時間點繪製及檢查 loop seam、重複同時間、2× scaling；Then 無例外或新增非預期空白；與固定上游比較，原設計的進場空白不誤判回歸。 | pending | [SDD AC-08](SDD.md#ac-08-保留動態示範)；待批准及最新整合驗證。 |
| AC-09 | Given 桌面、390×844 手機模擬與 reduced-motion；When 使用鍵盤、詳情、選取清單及切換系統偏好；Then 無水平溢出或控制項遮擋，焦點／Escape 正常，減少動態預設暫停並回應偏好變化。 | pending | [SDD AC-09](SDD.md#ac-09-桌面手機與無障礙)；待批准及最新整合驗證。 |
| AC-10 | Given 網站根目錄及 /nested/tools/motion-prompt/；When 瀏覽、動畫、搜尋、詳情與複製；Then 本地資源／規格／示範網址正確，480 個雙語項目與提示詞端點 HTTP 200，零非必要外連、404、console error 或未處理 rejection。 | pending | [SDD AC-10](SDD.md#ac-10-靜態子路徑與零遠端依賴)；待批准及最新整合驗證。 |
| AC-11 | Given metadata／locale；When 連續兩次建置並檢查 generated outputs；Then 產生 517 檔且位元組一致；缺譯、規格數值被改或 stale output 的負例都失敗，不靠手改產生檔。 | pending | [SDD AC-11](SDD.md#ac-11-單一來源與可重建)；待批准及最新整合驗證。 |
| AC-12 | Given 可散布來源清單；When 檢查匯入與 UPSTREAM；Then MIT、作者與第三方聲明保留，記完整 SHA／日期／範圍／排除／本地修改／同步方法；無未授權媒體、大型字型／宣傳素材、submodule 或執行時上游下載，且明示非官方繁中版。 | pending | [SDD AC-12](SDD.md#ac-12-授權與可維護邊界)；待批准及最新整合驗證。 |
| AC-13 | Given 最新 monorepo 基準與完整候選；When 依 README 啟動、建置及本地測試後發布任務分支與 Draft PR；Then 原始碼與網站可用，實際 SHA／數量／命令／結果／畫面／未驗證項可回讀，owner 驗收分開記錄，沒有 merge／deploy／新 CI 費用。 | pending | [SDD AC-13](SDD.md#ac-13-可執行交付與證據)；待批准及最新整合驗證。 |

## 現況與缺口

既有候選的 557 檔已復原並核對來源，但不在這份規格 PR 中。尚需批准 SDD、整合程式／完整翻譯／generated outputs、逐項補 AC 測試對應與必要重驗、專案任務板及網站 Draft PR。原始需求不因文件完成而縮減。

## 啟動與驗證

此分支為規格提案，沒有網站啟動入口。最終可執行命令在程式整合後提供並實跑，不將本 PR 當成可用網站。

文件驗證於 repo 根目錄：`python3 scripts/check_project_success.py`、`python3 scripts/check_indexes.py`。產品候選／歷史命令與日期見 [baseline](docs/evidence/baseline.md)，尚未在本分支執行產品測試。

## 可用版本

`usable_tag: none`；尚未 owner 驗收、未發布或部署。規格、CI 或歷史測試成功皆不代表主線完成。
