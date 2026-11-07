# SDD — 四職業能力圖鑑

- 日期：2026-10-31（Asia/Singapore）
- 需求：[issue #834](https://github.com/fallrising/newclear/issues/834)
- 狀態：**設計提案／文件基線；未實作、未實跑**。
- 依據：owner 要求用 Pixelorama 做遊戲實驗，先寫 SDD，以魔法師、騎士、射手、治療師的能力值頁作 Demo。
- 方案中的尺寸、影格、數值、技術棧由本 SDD 提出，不是 Pixelorama 限制，也不是 owner 已確認的美術定稿。

## 1. 實驗問題與成功邊界

驗證 Pixelorama 能否作為可編輯、可重新匯出的角色素材來源，並讓一個小型網頁 Demo 穩定消費產物。主要結果是「改原生素材 → 重匯出 → 頁面呈現更新」，不是畫一張像素風截圖。

本輪交付 SDD、素材契約、驗收與任務板。後續 P0 是可互動單頁；不以 SDD 合併代表 P0 完成。

不做：完整 RPG／MMORPG、ASCII glyph 世界、後端或 OAuth、戰鬥結算、AI NPC、裝備與成長經濟、多人同步、付費工具／素材、公網部署。既有 OpenMMO lab 不受本實驗修改。

## 2. 使用者旅程與頁面

單頁包含：四職業選擇列、中央角色預覽台、角色定位與招牌技能、六項能力值、等級選擇器及四職業同等級比較表。

1. 初次開啟預設魔法師、Lv.1、idle。
2. 點選職業，名稱、角色、能力、技能描述一起更新；保留目前等級，取消上一個職業未播完的技能。
3. 以帶標籤的 range＋數字輸入選 Lv.1–20，兩者同步；輸入非整數、空值或越界時提示錯誤並保留最後合法值。
4. 點「展示技能」播放一次專屬 effect 動畫；期間不排隊、不重入，按鈕暫停接受重複啟動。播完回 idle，**不扣 MP、不造成傷害、不模擬戰鬥**。
5. 「重設」回魔法師／Lv.1／idle。重新整理同樣回預設，不做持久化。
6. 動畫總開關可暫停；`prefers-reduced-motion` 預設停在第一格，技能改顯示關鍵影格與文字，不自行持續播放。

桌面採選擇列＋角色／能力雙欄；390px 手機採單欄，不要求拖曳或 hover。按鈕支援 Tab、Enter／Space，選中狀態用文字及 `aria-pressed` 表達，不只依靠顏色。能力與技能保持 DOM 文字，Canvas 只負責角色，提供替代描述。比較表在手機改卡片，不產生頁面橫向溢位。

視覺方向：深色奇幻圖鑑、可辨識職業剪影、低飽和背景與清楚數值；不是指定模仿商業遊戲的素材或 UI。

## 3. 四職業與視覺／技能契約

| ID | 名稱 | 定位 | 視覺識別 | 招牌技能預覽 |
| --- | --- | --- | --- | --- |
| mage | 魔法師 Mage | 遠程法術、高魔力 | 尖帽、法杖、紫藍符文 | 火球 Fireball：蓄光與小火球 |
| knight | 騎士 Knight | 前排防禦、高生命 | 盾牌、鎧甲、寬厚輪廓 | 盾擊 Shield Bash：盾牌前推與衝擊光 |
| archer | 射手 Archer | 遠程物理、高速度 | 弓、兜帽、輕裝 | 穿透箭 Piercing Arrow：拉弓與箭光 |
| healer | 治療師 Healer | 回復支援、高魔力 | 法袍、權杖、光環 | 治癒 Healing Light：光圈與上升粒子 |

每職業一份 48×48 透明 RGBA 原生工程；idle 4 格，每格 200ms；skill 6 格，每格 100ms。合計 10 格，總 skill 時間 600ms。特效納入同一 48×48 畫格，避免新增粒子引擎；尺寸不夠先簡化造型，不擅自改契約。四職業需能不看名稱辨識，其視覺品質由真實畫面審查，不由影格數測試替代。

## 4. 能力值：合成展示資料，不宣稱平衡

六項數值為最大生命 HP、最大魔力 MP、物理攻擊 ATK、防禦 DEF、法術強度 MAG、速度評級 SPD。HP／MP 為點數，其餘是 Demo 評級，SPD 不是像素／秒；沒有命中、抗性或傷害公式。治療師的定位由技能語義表達，不把 MAG 偷換成已驗證的治療量。

所有職業共用公式：`value(level) = base + growth * (level - 1)`，合法整數 `1 <= level <= 20`。不使用隨機數、不疊裝備。以下數值是唯一設計資料表；實作時轉入單一 typed data 檔，頁面、比較表及測試不得各自複製一套。

| 職業 | HP 基礎／成長 | MP 基礎／成長 | ATK 基礎／成長 | DEF 基礎／成長 | MAG 基礎／成長 | SPD 基礎／成長 |
| --- | --- | --- | --- | --- | --- | --- |
| mage | 80 / 6 | 120 / 10 | 15 / 2 | 12 / 2 | 32 / 5 | 20 / 1 |
| knight | 150 / 12 | 40 / 3 | 28 / 4 | 35 / 5 | 8 / 1 | 12 / 1 |
| archer | 100 / 8 | 60 / 5 | 32 / 5 | 18 / 3 | 12 / 2 | 32 / 2 |
| healer | 90 / 7 | 130 / 11 | 10 / 1 | 16 / 2 | 28 / 4 | 18 / 1 |

能力條按每個指標各自固定上限正規化：HP=400、MP=400、ATK=140、DEF=140、MAG=140、SPD=80。標籤一律顯示原始值與單位；同指標跨職業共用尺度，不把不同指標的長度當作相同戰力。資料驗證遇到負值、NaN、未知職業或超出尺度應失敗，不能偷偷 clamp 後掩蓋問題。

數值測試 oracle：Mage Lv.10 = `[134,210,33,30,77,29]`；Knight Lv.20 = `[378,97,104,130,27,31]`；Archer Lv.20 = `[252,155,127,75,50,70]`；Healer Lv.20 = `[223,339,29,54,104,37]`，順序為 HP/MP/ATK/DEF/MAG/SPD。Lv.1 必須等於 base，Lv.0/21/1.5/NaN 必須拒絕。

## 5. 架構與資料邊界

提案採 TypeScript＋Vite、DOM/CSS 能力 UI、Canvas 2D sprite 預覽。此小頁不引入 React、Three.js、Godot runtime 或網路遊戲框架。Pixelorama 本身使用 Godot 不構成必須使用 Godot 製作客戶端的理由。依賴版本於實作開始時核對、鎖定並提交 lockfile；本輪不寫未驗證的版本號或安裝成功聲明。

資料流：

```text
Pixelorama .pxo
  → 真 Pixelorama CLI 匯出 PNG + 原始 JSON
  → adapter 驗證／正規化 + manifest（尺寸、影格、來源 hash）
  → Canvas sprite player

單一 class data → 等級純函數 → DOM 能力頁 + 比較表
UI state（classId, level, animation, paused）→ renderer
```

Pixelorama JSON 視為版本化外部格式，不假設直接等同 web manifest。adapter 只接受固定版本已觀察的格式；缺欄、錯格數、缺檔、未知 schema 或 atlas 超界時明確失敗。每個職業需穩定 ID、zh-TW／en 名稱、定位、六項 base/growth、skill ID 與 asset ID。

正規化 asset manifest 至少含：schemaVersion、classId、source `.pxo` 路徑／SHA-256、Pixelorama version、binary SHA-256、PNG 路徑／SHA-256／寬高、10 個 frame rectangle/durationMs、idle `[0,4)` loop 與 skill `[4,10)` once。範圍採零基底、右界不含。原始 JSON 與 manifest 分開保留。

PNG 480×48，10 格橫排；關閉 trimming／padding／縮放，透明底。若固定版本無法穩定直接輸出此排版，可由 adapter 重排真匯出 PNG，但保留原始輸出與轉換紀錄，不把自行畫的 PNG 冒稱 Pixelorama 匯出。Canvas 關閉 image smoothing，依 DPR 設 backing store；單一 requestAnimationFrame 迴圈，切職業不新增永久迴圈，頁面隱藏時暫停、回來重設時間基準。

載入失敗顯示職業名、缺檔訊息與重試按鈕；不可靜默改用占位圖讓測試通過。畫面成功載入後不需要外網、CDN、API key 或雲端服務。

## 6. 原始碼與素材布局（後續實作時建立）

`src/data/classes.ts`、`src/domain/stats.ts`、`src/ui/`、`src/render/`；`assets/source/{id}.pxo` 保存原稿，`assets/raw-export/` 保存真匯出，`public/assets/` 保存 web 產物；`scripts/export-assets.*`、`scripts/validate-assets.*`、`tests/` 與 `assets/provenance.json` 保存管線、測試及來源。

以上是預定布局，不是已存在檔案。此文件階段不建空資產資料夾、假 `.pxo`、假 lockfile 或假測試報告。binary 與 cache 在 repo 外，原生四角色小素材及必要輸出可版控，總素材預算 5 MiB，超過先找原因。

## 7. 固定驗收條件

以下 AC 定義產品主線，不因文件通過而標成 passed。實作時建立帶 AC 編號的可執行測試；GUI／視覺部分另留人工審查證據。

| AC | Given / When / Then | 必要證據 |
| --- | --- | --- |
| AC-01 | Given 四個原生 `.pxo` 與已記版本／hash 的 Pixelorama；When 逐個開啟並以真 CLI 匯出；Then 四個角色皆有 10 格、正確 tag／時間／透明底與來源紀錄。 | 原生工程、CLI 命令與 exit code、原始輸出、實際編輯器檢視；占位圖不算 |
| AC-02 | Given 已驗證輸出與乾淨 checkout；When 正規化並啟動網頁、切換四職業；Then 角色圖、名稱、技能、能力一致，無缺檔或未捕捉 console error。 | adapter 測試、真頁面 E2E、四職業截圖 |
| AC-03 | Given Lv.1/10/20 與非法輸入；When 計算、輸入並比較職業；Then 符合第 4 節 oracle／尺度，拒絕非法值，所有 UI 共用同一資料。 | 純函數單元測試＋輸入／比較 E2E |
| AC-04 | Given idle／skill／暫停狀態；When 播技能、連點、切職業、切背景頁；Then skill 只播一次、600ms 後回 idle，無殘留角色或多重迴圈；減少動態模式顯示靜態語義。 | 計時與狀態機測試＋真瀏覽器觀察 |
| AC-05 | Given 390×844 與 1440×900 視窗；When 鍵盤操作、改級與播技能；Then 操作可達、焦點可見、文字可讀、無頁面橫向溢位，四職業剪影可辨識。 | Chromium／Firefox／WebKit 測試與桌面／手機視覺審查；Safari 實機另記 |
| AC-06 | Given 固定工具與同一 `.pxo`；When 連續兩次匯出並做一次可辨識像素修改；Then 未修改時尺寸／影格／解碼 RGBA 一致，修改後頁面出現對應改變。 | export diff、source/output hashes、修改前後截圖；hash 改變本身不證明視覺正確 |
| AC-07 | Given 乾淨 checkout 與文件前提；When 安裝鎖定依賴、測試、build、preview 並載入；Then 可重現核心流程，無外部請求、私人資料或未列授權素材。 | 精確版本／命令／輸出、依賴與素材清單、網路檢查與獨立 review |

## 8. 實作順序與停止條件

先完成一位魔法師的真 `.pxo` → 匯出 → 最小頁面閉環（AC-01/02/06），再沿同一資料契約補三職業與能力 UI（AC-03），最後補動畫、無障礙、跨瀏覽器與乾淨重現（AC-04/05/07）。不開四個彼此不同的素材管線，也不先建平台或後端。

第一步即遇到 Pixelorama 無法運行、原生檔無法開啟或匯出格式不符，保留錯誤與版本，停止依賴此輸出的工作；不要先用 mock 把整個頁面做完再宣稱試用成功。取得真樣本後才能鎖定 adapter fixture。

本輪 SDD 尚未用參考 Demo 實跑所有 AC；這是規格提案的驗證缺口，不能稱已完成可執行契約。合併、實作、runtime 驗收與 owner 的視覺驗收分開記錄。

## 9. 來源與未決項

官方查核日：2026-10-31。

- [Pixelorama repository](https://github.com/Orama-Interactive/Pixelorama)：像素素材／動畫、匯出與工具定位。
- [CLI 手冊](https://pixelorama.org/user_manual/cli/)：桌面 CLI、headless、spritesheet、JSON；實際語法仍以選定 binary 的 help 為準。
- [Save and Export](https://pixelorama.org/user_manual/save_and_export/)：實作前核對原生工程／匯出操作。

未決項限於實作需要：固定 Pixelorama stable binary 的版本與 hash、該版原始 JSON 範例、原生工程編輯環境、實際可用瀏覽器矩陣。這些未決項不阻止 SDD 入庫，卻會阻止相應 runtime AC 通過。所有視覺素材需自行創作或明確可用來源；工具的 MIT 不替第三方素材授權。
