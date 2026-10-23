# 江山時序上游分析與獨立重作取捨

研究日期：2026-10-23。任務：[newclear #514](https://github.com/fallrising/newclear/issues/514)。設計契約見 [SDD](../SDD.md)。

本文件固定分析 `DeanChensj/jiangshan-map` 的 commit `5e940f6bc1f8aa50ac7fe0e2406baee7ef5ef7e7`，區分已觀察行為與 `products/history-atlas` 的設計提案。這次交付僅有分析及規格；沒有匯入上游程式、歷史資料、幾何、字型或圖片，也沒有完成產品 runtime。來源固定在文末，避免以後的上游更新改變證據。

## 1. 產品用途與功能對照

**已觀察：** 上游把年代、地點、人物與史事放在同一張互動地圖。使用者可拖曳時間軸觀看政權與政區變化，查同一地點的歷代名稱，或沿著人物、詩詞路線探索歷史。其主要價值是讓文字中的時間與空間能互相定位。[S1][S2]

| 能力 | 上游實現與資料 | 新案取捨提案 |
| --- | --- | --- |
| 年代與疆域 | 時期、重大事件、政權快照、前一階段虛線邊界 | 先建立年份選擇及圖層切換；是否有某年疆域取決於已核准資料 |
| 古今地名沿革 | 城池、關隘、座標及跨時期政區查詢 | 採穩定地點 ID、有效年代與別名，保留來源及不確定性 |
| 人物行跡 | 人物事件、地點與年份同步，另有預設旅程 | 先支持有出處的少量事件序列，避免把推測畫成確定路線 |
| 詩詞路線 | `year`、`place` 可表示單點、同年多點及跨年多點 | 保留可分享的探索概念，另定可版本化的 URL 契約 |
| 古地名挑戰 | 盲圖落點，依距離計分 | v1 後段 M3；先完成資料與探索核心，再依 AC-14 驗收 |
| 古今參照與水系 | 現代省界、河道、湖泊、長城與交通走廊 | 分離圖層與資料來源；缺資料時明確標示缺口 |
| Agent 操作 | deep link、瀏覽器 API、Python CLI | 先規範唯讀查詢和導覽 API，截圖工具延後 |

前輪載入固定版本的資料後，計得 18 個時期、167 個快照鍵、442 條事件、113 個人物 profiles。快照鍵不是獨立考證完成的地圖數；README/About 的 164 與部分 SEO 的 166 也未同步。因此新案不以這些數量作完整度目標，應由資料驗證產生統計。[S2][S3][S4]

## 2. 已觀察的架構與資料流

上游主站使用原生 JavaScript ES6、CSS 與 SVG，`app.js` 自行實作 Mercator 投影、縮放平移、標籤排布和互動控制。主地圖沒有 Leaflet、Mapbox 或框架執行相依。HTML 和靜態資源可由一般 HTTP server 提供，不需資料庫或應用後端。[S2][S5]

資料流主要有三段：

1. **載入資料：** `index.html` 載入現代省界、首屏快照、時期資料、掌故資料及控制器，形成 `window` 下的資料物件。
2. **解析狀態：** 控制器從 URL 或操作取得年份、地點、人物，再找對應時期、快照、事件和座標。搜尋索引也由這些資料組成。
3. **更新呈現：** 幾何投影成 SVG；時間軸、卡片、圖例、搜尋及分享狀態同步。地點查詢還會判斷其所屬政權、歷史政區及現代參照。[S2]

`map_data.js` 承載時期、城池、事件及交通水系；`lore_data.js` 承載年號、君主、人物、地方掌故及詩詞。這種分工容易理解，但約一萬行的 `app.js` 同時包含渲染、查詢、語言、SEO、遊戲和音樂，後續修改的耦合較高。[S2][S3]

### 壓縮與延遲載入

`atlas_boot.js` 提供戰國首屏 seed；之後 `_ensureFullSnapshots()` 才載入完整 `atlas_snapshots.js`。後者以共享環線及 VLQ 增量編碼降低座標重複，按需解碼並處理快照間的引用。這是「先載入 seed，再載完整快照包」，不能說成已按朝代分檔下載。英文詞典也由 `_ensureEnglishLocale()` 延遲載入。[S2][S4]

**新案提案：** 先用可審查的靜態 JSON 和標準幾何格式，讓來源、版本、時效與引用關係容易驗證；按資料集或時段分包，量測載入量後才增加壓縮。共享幾何及差分是可借鑒的方向，沒有必要在首版重建上游專用編碼。

## 3. 地名、人物 API 與 GeoJSON

上游 `window.atlasAPI` 的 `resolvePlace()` 尋找座標，`inspect()` 回傳歷史地理資訊，`locate()` 驅動地圖。`year`、`place` 支持多點配對；`person` 可開啟人物事件序列。這是前端資料查詢和導覽協議，本身不會呼叫 LLM 推理。Python CLI 可產生 URL；需要截圖或瀏覽器查詢時，仍須有 Chrome／Chromium 等執行環境，不能把「無 Python 第三方套件」理解為所有功能無外部前置條件。[S2][S6]

固定版本另有 `scripts/export_geojson.js`：解碼快照、展開政區引用，輸出標準 GeoJSON 和年份索引，提供下游 Leaflet、GIS 工具使用。該匯出明確止於 1948 年；現代 `s_prc` 的原始快照留空，主站由現代省界補入，匯出器沒有合成它。`geojson/jiangshan-locate.js` 依年份讀索引和單一快照，以 bbox 篩選再做點在多邊形內判斷。[S7][S9]

**新案提案：** 以穩定 ID 作 API 輸入的優先選項，文字搜尋回傳候選與年代，遇到同名地點要求選擇，不靜默猜測。查詢結果須攜帶資料版本、來源及近似程度。GeoJSON 可作交換格式；是否開放下載仍須逐資料集核對授權，轉格式不會消除原授權限制。

## 4. 繁中支援的實際缺口

上游 locale 只有 `zh` 和 `en`；非 `lang=en` 一律進入簡中分支，HTML 語言為 `zh-CN`。翻譯由 helper、英文詞典及大量 inline 中英條件分支混用；地名、年號、掌故、工具提示、ARIA 和 SEO 也各有文字來源。[S2][S5]

前輪以 Node VM 載入原始控制器及資料，呼叫搜尋與地名解析，得到下列對照。這是控制器探查，**不是瀏覽器或手機介面驗證**。

| 簡體輸入 | 對應繁體輸入 | 觀察 |
| --- | --- | --- |
| 长安、洛阳、襄阳 | 長安、洛陽、襄陽 | 簡體有結果；繁體搜尋皆為 0，地名解析皆為 null |
| 苏轼、诸葛亮 | 蘇軾、諸葛亮 | 簡體可找到人物；繁體搜尋皆為 0 |
| 李白 | 李白 | 搜尋有 7 個結果 |

**新案提案：** 預設 `zh-Hant`，由資料鍵與顯示字串分離開始，集中介面詞條；搜尋同時支持簡繁別名及英文。轉換工具只能協助產生候選，古地名、人名與「后／後」等歧義要經例外表及人工校對。URL、API、卡片與搜尋應使用同一組解析規則，避免只有畫面變繁中、輸入仍查不到。

## 5. 外部依賴與搬移成本

| 已觀察的連線 | 用途 | 新案決策提案 |
| --- | --- | --- |
| Google Fonts | 簡中文字型與書法字型 subset | 使用系統繁中字型起步；日後另審自託管字型授權 |
| VerCount、Cloudflare Web Analytics | 訪問統計；HTML 含上游 beacon 設定 | 預設不加入分析追蹤 |
| Wikimedia Commons | 古琴音訊 | 首版不包含音樂，避免新增下載及授權面 |
| unpkg、OpenStreetMap tiles | 僅 GeoJSON demo 的 Leaflet 與底圖 | 主站維持原生 SVG；圖磚如需引入另列依賴 |

在已讀主站程式中未見付費 LLM、Mapbox／Google Maps API 或 Workers／Durable Objects 呼叫；這不等於任何託管方式永遠免費。主站的 canonical、OG、JSON-LD、SEO 目錄與部分校驗則硬編碼上游域名，CLI 也有上游預設 URL。新案應從開始統一 site base URL 與子路徑設定，不沿用統計 token 或上游 canonical。[S2][S3][S5][S6][S10]

## 6. 獨立重作的邊界與優先順序

採用相同技術棧，並不需要沿用上游的函式、資料結構、壓縮包或視覺素材。新案提案是原生 JavaScript 模組、SVG 渲染、靜態 JSON，將載入與驗證、查詢、狀態、投影、呈現及語言分開。先用自行撰寫且標示用途的測試資料驗證互動，再接入具有可核對授權與史料來源的正式資料；測試資料不能冒充歷史成果。

上游明示歷史疆域是示意近似，且 README 對部分 CHGIS／Hartwell 衍生邊界保留原資料條款。新案須逐項記錄來源、可使用範圍與轉換過程；沒有幾何資料時，仍可提供有出處的地點、事件與人物探索，不以推測邊界填空。[S1]

這份分析沒有作「乾淨室」或法律無風險的保證。未來若決定採用任何上游程式或資料，必須另行記錄採用範圍、權利依據及相應義務；本輪只把產品概念與工程取捨轉成 [SDD](../SDD.md)。

## 7. 歷史驗證紀錄與限制

以下沿用 2026-10-23 前輪、同一上游 SHA 的結果，本輪文件工作沒有重跑：

- **通過：** 已取得的 10 個 JavaScript 檔案可由 Node 解析；包含 7 個核心 JS、validator、GeoJSON 匯出器及 locate helper。
- **已觀察：** 上表的簡繁搜尋對照及資料計數，使用 Node controller harness。
- **通過：** 直接執行 Python CLI，以 `--year '1079, 1080, 1094, 1097' --place '湖州 → 黄州 → 惠州 → 儋州'` 產生正確路線 URL，exit code 0。
- **未完成：** `node scripts/validate_atlas.js` 在第 897 行呼叫 Python subprocess 時遇到環境錯誤 `spawnSync python3 EPERM`，exit code 1；此前沒有 assertion failure，但後續未執行，不能宣稱完整測試通過。[S8]
- **未驗證：** 真實瀏覽器渲染、手機手勢、無障礙操作、外部資源可用性、全量史料正確性，以及新案任何 runtime 行為。

## 固定版本來源

- [S1：README、功能與資料授權說明][S1]
- [S2：app.js 控制器、搜尋、語言與 API][S2]
- [S3：lore_data.js 人物與掌故資料][S3]
- [S4：atlas_snapshots.js 壓縮快照格式][S4]
- [S5：index.html 載入入口、外連與 SEO][S5]
- [S6：Python CLI][S6]
- [S7：GeoJSON 匯出器][S7]
- [S8：上游校驗器][S8]
- [S9：GeoJSON 地點查詢 helper][S9]
- [S10：GeoJSON 的 Leaflet 展示頁][S10]

[S1]: https://github.com/DeanChensj/jiangshan-map/blob/5e940f6bc1f8aa50ac7fe0e2406baee7ef5ef7e7/README.md
[S2]: https://github.com/DeanChensj/jiangshan-map/blob/5e940f6bc1f8aa50ac7fe0e2406baee7ef5ef7e7/js/app.js
[S3]: https://github.com/DeanChensj/jiangshan-map/blob/5e940f6bc1f8aa50ac7fe0e2406baee7ef5ef7e7/js/lore_data.js
[S4]: https://github.com/DeanChensj/jiangshan-map/blob/5e940f6bc1f8aa50ac7fe0e2406baee7ef5ef7e7/js/atlas_snapshots.js
[S5]: https://github.com/DeanChensj/jiangshan-map/blob/5e940f6bc1f8aa50ac7fe0e2406baee7ef5ef7e7/index.html
[S6]: https://github.com/DeanChensj/jiangshan-map/blob/5e940f6bc1f8aa50ac7fe0e2406baee7ef5ef7e7/skills/jiangshan-atlas/scripts/jiangshan.py
[S7]: https://github.com/DeanChensj/jiangshan-map/blob/5e940f6bc1f8aa50ac7fe0e2406baee7ef5ef7e7/scripts/export_geojson.js
[S8]: https://github.com/DeanChensj/jiangshan-map/blob/5e940f6bc1f8aa50ac7fe0e2406baee7ef5ef7e7/scripts/validate_atlas.js
[S9]: https://github.com/DeanChensj/jiangshan-map/blob/5e940f6bc1f8aa50ac7fe0e2406baee7ef5ef7e7/geojson/jiangshan-locate.js
[S10]: https://github.com/DeanChensj/jiangshan-map/blob/5e940f6bc1f8aa50ac7fe0e2406baee7ef5ef7e7/geojson/demo.html
