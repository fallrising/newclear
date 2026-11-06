# 已觀測CF服務的用途目錄

2026-11-02T15:28:15Z以原Cloudflare連線唯讀核對Workers、Custom Domains、最新deployment與Cron。4個Worker對應2個主要工具與各自保留的恢復驗證環境；存在不等於健康、可登入或可封存。此頁公開角色導航，精確Worker名稱／入口／版本／私人來源在私人`tool-catalog.json`及`tool-catalog.md`，沒有公開私人部署資料。

| 角色 | 用途／來源責任 | 觀測到的觸發／入口 | 處置 |
| --- | --- | --- | --- |
| Cloud Lab日常入口 | [Cloud Lab](../README.md)管理命令／成果／盤點；主機runner保留本地journal | HTTP API／Access看板、15分鐘Cron；一個啟用的Custom Domain，preview關閉；最新版本與ML記錄相同 | keep-in-place；人類讀取／盤點上傳，原排程期限不變 |
| Cloud Lab隔離恢復環境 | [RF歷史驗證](evidence/m1-remote-recovery.md)保留故障／撤權／恢復邊界 | HTTP機器API，無Cron；一個啟用的Custom Domain，preview關閉；不把它當日常看板 | 保留；不因名稱相近而封存，未驗當前應用授權／資料 |
| P-NOTES日常入口 | 原私人筆記／提問工具，原產品掌握內容／版本／逐篇agent授權 | HTTP UI／API，無Cron；一個啟用的Custom Domain，preview關閉；最新版本與原產品部署記錄一致 | keep-in-place；先導航，不遷移內容或共用登入session |
| P-NOTES隔離還原環境 | 原筆記產品的還原／邊界驗證 | HTTP，無Cron；一個啟用的Custom Domain，preview關閉；來源記錄其還原角色 | 保留；不承接日常寫入，不重跑已有恢復流程 |

Custom Domain→Worker來自provider實際映射，沒有用名稱猜入口。用途／責任來自固定來源README、SUCCESS與歷史部署證據；筆記產品的版本對照不等於本輪逐byte驗證其程式。本輪沒有完整zone-route查詢、應用登入或資料讀取；Pages／Tunnels仍沿用先前403 unknown，沒有為全綠補權限。

這是現有[CF工具目錄](tool-catalog.md)的部署補充，不另建provider同步器。原P-INVENTORY仍是唯一desired／用途維護來源；目前沒有改其desired或把此文件重新上傳成盤點報告。之後更新用途，先在原來源PR核對帳號範圍／資源角色，再產生新報告。未知用途留unknown；恢復環境是否退役須核對保留責任／caller及回退，不由這輪自動決定。

下一步的主機擴展見[多VPS agent設計](host-agent-design.md)：目前仍只有一個已接入runner。CF資源清單、主機觀測與工作負載控制是三種資料／責任，不能互相替代。
