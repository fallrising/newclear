---
project: labs/pixelorama-class-showcase
purpose: 驗證 Pixelorama 素材管線與四職業能力值展示
kind: lab
mainline: incomplete
usable_tag: none
reviewed: 2026-10-31
source_commit: 427f557b94ce56a97a0daa9427d894dae64fc8fe
---

# 四職業能力圖鑑：成功契約

## 主線與範圍

以 Pixelorama 原生素材，完成魔法師、騎士、射手、治療師的單頁能力展示。需求與固定 AC 以 [SDD](SDD.md) 為準；本輪僅建立 SDD 基線，沒有可執行 Demo。來源 commit 是本輪核對的 repo 基準，不是已存在產品的驗收版本。

不做完整 RPG／MMORPG、ASCII 世界、後端、多人、付費或公開部署。進度以 [任務板](docs/tasks/BOARD.md) 為準，驗收以 [證據紀錄](docs/acceptance.md) 為準。

## 驗收條件

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 四個原生 .pxo 與固定工具，When 真正開啟並匯出，Then 每職業 10 格、時間與來源契約成立。 | pending | 尚無原生工程與 Pixelorama 執行證據；詳見 SDD §7。 |
| AC-02 | Given 真匯出產物，When 啟動頁面切換職業，Then 圖像、名稱、能力與技能一致且無載入錯誤。 | pending | 尚無前端、adapter 或 E2E；詳見 SDD §7。 |
| AC-03 | Given 合法與非法等級，When 計算與比較能力，Then 符合 oracle 並拒絕非法輸入。 | pending | 僅設計數值表，尚無產品純函數與 UI 測試；詳見 SDD §4、§7。 |
| AC-04 | Given 動畫狀態，When 播放、連點、切換與暫停，Then 無重入或殘留且減少動態模式成立。 | pending | 尚無動畫 runtime；詳見 SDD §7。 |
| AC-05 | Given 桌面／手機視窗，When 鍵盤與觸控操作，Then 可達、可讀、不溢位且四職業可辨識。 | pending | 尚無真實畫面、跨瀏覽器或人工視覺驗收；詳見 SDD §7。 |
| AC-06 | Given 同原稿與固定工具，When 重複匯出及修改一個可辨識像素，Then 輸出可重現且網頁反映修改。 | pending | 尚未試跑 Pixelorama；詳見素材管線。 |
| AC-07 | Given 乾淨 checkout，When 安裝、測試、build、preview，Then 核心流程可重現且沒有外部服務或不明素材。 | pending | 尚無執行專案與乾淨環境重現；詳見 SDD §7。 |

## 現況與缺口

已建立設計：四職業、能力公式、頁面互動、素材規格與逐 AC 實作順序。這是文件產物，不是 runtime evidence。

待完成：固定 Pixelorama binary、魔法師真素材閉環、四職業素材、adapter、前端與測試、視覺審查。不得以占位 PNG、程式生成假 pxo 或文件檢查取代真實素材驗證。下一步先完成魔法師的 AC-01/02/06 垂直切片；其餘職業沿相同管線補齊。

## 啟動與驗證

目前無可啟動 Demo。文件／索引入口為根目錄 `python3 scripts/check_project_success.py --projects labs/pixelorama-class-showcase` 與 `python3 scripts/check_indexes.py`；本輪實際執行範圍及限制記在 [驗收紀錄](docs/acceptance.md)。

素材操作規格見 [Pixelorama 管線](docs/pixelorama-pipeline.md)。該文件中的 CLI 是待實測的範本，不是成功紀錄。

## 可用版本

`usable_tag: none`。AC-01–07 均待實作／實測；不建立 release、usable tag 或部署。Draft PR 只供審閱 SDD，未合併前任務板不標 done。
