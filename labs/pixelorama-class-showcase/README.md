# Pixelorama Class Showcase — 四職業能力圖鑑

> **狀態：SDD／設計階段，尚無可執行 Demo。** 主線驗收、缺口與版本以 [SUCCESS.md](SUCCESS.md) 為準；`usable_tag: none`。

以魔法師（Mage）、騎士（Knight）、射手（Archer）、治療師（Healer）的角色能力頁，驗證 **Pixelorama 原生素材 → spritesheet／JSON 匯出 → 瀏覽器展示** 的完整路徑。Pixelorama 是素材編輯器，不是這個 Demo 的遊戲引擎。

本輪依 owner 的「可以先寫 SDD」建立文件基線。沒有 `.pxo`、PNG 成品、前端實作或 Pixelorama 實跑證據；不得把此目錄當成已完成遊戲。

## 入口

- [SDD](SDD.md)：四職業、數值、互動、資料契約、驗收與實作順序。
- [素材管線](docs/pixelorama-pipeline.md)：原生工程、真 CLI 匯出、授權與可重現要求。
- [任務板](docs/tasks/BOARD.md)：認領、每條 AC、進度與唯一下一步。
- [驗收紀錄](docs/acceptance.md)：文件與 runtime 證據分開記錄。
- [Issue #834](https://github.com/fallrising/newclear/issues/834)：需求與承接入口。

## 預定使用情境

開啟本機頁面 → 選職業 → 看像素角色與六項能力 → 調整 Lv.1–20 → 預覽招牌技能 → 回到待機。桌面與手機使用同一套資料，文字採繁體中文＋英文職業名。

不做帳號、後端、戰鬥結算、背包、交易、多人同步、LLM provider、付費素材或公開部署；不修改既有 OpenMMO lab。這是獨立的素材／UI 實驗，不是 ASCII MMORPG 的替代實作。

## 啟動與檢查

目前沒有啟動命令；不提供尚不存在的 `npm run dev`。後續依 SDD 建立並驗證開發與預覽入口，再更新本節。現階段 repo 結構檢查入口為根目錄的 `python3 scripts/check_indexes.py`；該檢查不證明 Demo 可玩。
