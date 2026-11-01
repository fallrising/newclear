---
project: tools/motion-prompt
purpose: 以繁中與英文動態示範辨認術語並複製 AI 提示詞
kind: tool
mainline: incomplete
usable_tag: none
reviewed: 2026-10-28
source_commit: fb58656083231c282a64baf20602aa662caf4eee
---

# Motion Prompt 成功契約

## 主線與範圍

[SDD](SDD.md) 已批准；本候選完整整合網站與同一組固定 AC，實作交付 Draft PR，owner 最終驗收待定。範圍是 5 packs／120 項完整雙語靜態圖鑑，不新增後端、追蹤、付費服務、Skill／CLI 或大型框架；文檔檔位未分級。

## 驗收條件

以下為 2026-10-28 實作自驗結果；[最新證據](evidence/VERIFICATION.md) 與 [歷史基準](docs/evidence/baseline.md) 分開。passed 不代表 owner 已驗收或主線完成。

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 固定上游 SHA 與來源 manifest；When 比對全部項目；Then 5 packs 各 24 項、共 120 項的 ID、slug、英文名稱及分類與來源完全一致。 | passed | [SDD AC-01](SDD.md#ac-01-固定來源與完整匯入)；[本輪實測與限制](evidence/VERIFICATION.md)。 |
| AC-02 | Given 任一項目；When 讀取 zh-Hant／en；Then 名稱、意思、用途、AI 例句、動作／視覺規格、可複製提示詞皆完整，缺繁中必須使建置失敗，不得靜默 fallback。 | passed | [SDD AC-02](SDD.md#ac-02-完整雙語內容)；[本輪實測與限制](evidence/VERIFICATION.md)。 |
| AC-03 | Given 英日來源與 Canvas；When 核對翻譯；Then ID／slug 不重編，612 條規格的數值、單位、條目順序、方向及動作語意一致；dolly 與 zoom 不混淆。 | passed | [SDD AC-03](SDD.md#ac-03-翻譯與規格忠實度)；[本輪實測與限制](evidence/VERIFICATION.md)。 |
| AC-04 | Given 首次開啟與已輸入搜尋、備註、選取；When 切換介面語言；Then 預設繁中並顯示繁中＋英文術語，英文模式無繁中解釋；狀態保留，導覽／錯誤／空結果／ARIA／畫布有意義標籤均本地化。 | passed | [SDD AC-04](SDD.md#ac-04-介面語言與狀態)；[本輪實測與限制](evidence/VERIFICATION.md)。 |
| AC-05 | Given 全部資料；When 搜尋繁中、英文、關鍵字、#005／005／5 並依 pack／分類篩選；Then 正確匹配、數量更新且無結果狀態可理解。 | passed | [SDD AC-05](SDD.md#ac-05-尋找效果)；[本輪實測與限制](evidence/VERIFICATION.md)。 |
| AC-06 | Given 單項 ID 或分享選取連結；When 直接開啟、重新整理或鍵盤切換項目；Then 顯示正確效果與規格，詳情可關閉並恢復焦點。 | passed | [SDD AC-06](SDD.md#ac-06-詳情與深連結)；[本輪實測與限制](evidence/VERIFICATION.md)。 |
| AC-07 | Given 單項與跨 pack 多選及使用者備註；When 分別選繁中／英文複製；Then 真實剪貼簿含所選語言的完整規格與備註，無須切換介面，清除與分享選取可用。 | passed | [SDD AC-07](SDD.md#ac-07-獨立提示詞語言)；[本輪實測與限制](evidence/VERIFICATION.md)。 |
| AC-08 | Given 每項兩語示範；When 播放並在至少 8 個時間點繪製及檢查 loop seam、重複同時間、2× scaling；Then 無例外或新增非預期空白；與固定上游比較，原設計的進場空白不誤判回歸。 | passed | [SDD AC-08](SDD.md#ac-08-保留動態示範)；[本輪實測與限制](evidence/VERIFICATION.md)。 |
| AC-09 | Given 桌面、390×844 手機模擬與 reduced-motion；When 使用鍵盤、詳情、選取清單及切換系統偏好；Then 無水平溢出或控制項遮擋，焦點／Escape 正常，減少動態預設暫停並回應偏好變化。 | passed | [SDD AC-09](SDD.md#ac-09-桌面手機與無障礙)；[本輪實測與限制](evidence/VERIFICATION.md)。 |
| AC-10 | Given 網站根目錄及 /nested/tools/motion-prompt/；When 瀏覽、動畫、搜尋、詳情與複製；Then 本地資源／規格／示範網址正確，480 個雙語項目與提示詞端點 HTTP 200，零非必要外連、404、console error 或未處理 rejection。 | passed | [SDD AC-10](SDD.md#ac-10-靜態子路徑與零遠端依賴)；[本輪實測與限制](evidence/VERIFICATION.md)。 |
| AC-11 | Given metadata／locale；When 連續兩次建置並檢查 generated outputs；Then 產生 517 檔且位元組一致；缺譯、規格數值被改或 stale output 的負例都失敗，不靠手改產生檔。 | passed | [SDD AC-11](SDD.md#ac-11-單一來源與可重建)；[本輪實測與限制](evidence/VERIFICATION.md)。 |
| AC-12 | Given 可散布來源清單；When 檢查匯入與 UPSTREAM；Then MIT、作者與第三方聲明保留，記完整 SHA／日期／範圍／排除／本地修改／同步方法；無未授權媒體、大型字型／宣傳素材、submodule 或執行時上游下載，且明示非官方繁中版。 | passed | [SDD AC-12](SDD.md#ac-12-授權與可維護邊界)；[本輪實測與限制](evidence/VERIFICATION.md)。 |
| AC-13 | Given 最新 monorepo 基準與完整候選；When 依 README 啟動、建置及本地測試後發布任務分支與 Draft PR；Then 原始碼與網站可用，實際 SHA／數量／命令／結果／畫面／未驗證項可回讀，owner 驗收分開記錄，沒有 merge／deploy／新 CI 費用。 | passed | [SDD AC-13](SDD.md#ac-13-可執行交付與證據)；[本輪實測與限制](evidence/VERIFICATION.md)。 |

## 現況與缺口

5 packs／120 項與所有產生檔已整合；44 項真實瀏覽器檢查、480 API 端點、兩語及固定上游各 120 項動畫檢查通過。待 owner 確認翻譯／視覺適切性與最終驗收；Safari、Firefox、實體手機和部署環境未測。實作 PR 保持 Draft，故 mainline 維持 incomplete，未建立可用版本。任務進度見 [BOARD](docs/tasks/BOARD.md)。

## 啟動與驗證

從元件目錄執行 `python3 -m http.server 8000 --bind 127.0.0.1`，開啟 http://127.0.0.1:8000/。不需要 Node 套件即可瀏覽。建置 `node tools/build.mjs`、檢查 `npm run check`；安裝測試開發依賴與 Chromium 後執行 `npm test`。完整命令、環境與標準瀏覽器下載限制見 [README](README.md) 及 [實測紀錄](evidence/VERIFICATION.md)。

Repo gates：`python3 scripts/check_project_success.py`、`python3 scripts/check_indexes.py`；未新增 CI workflow。

## 可用版本

`usable_tag: none`；尚未 owner 驗收、未發布或部署。規格、CI 或歷史測試成功皆不代表主線完成。
