# Pixelorama 素材交接與實驗流程

> 設計文件；目前沒有安裝、編輯或匯出成功紀錄。需求見 [SDD](../SDD.md)，狀態見 [SUCCESS](../SUCCESS.md)。

## 官方證據與責任邊界

2026-10-31 讀取 [Save and Export](https://pixelorama.org/user_manual/save_and_export/) 與 [CLI 手冊](https://pixelorama.org/user_manual/cli/)。原生保存是 `.pxo`；供其他軟體使用的是匯出圖像。CLI 僅限桌面版本，列有 `--headless`、`--quit`、使用者參數分隔符 `--`、`--export`、`--spritesheet`、`--json`、`--output`。文件支持能力存在，不證明任意版本的輸出 schema／檔名／圖集配置相同。

## 先做一位魔法師的真實閉環

1. 從官方 stable release 選 desktop binary，記版本、來源 URL、OS／架構、下載檔與可執行檔 SHA-256；binary 不進 repo，不使用未記錄的 latest。版本未確認前不填假的 lock。
2. 用 Pixelorama 建立 48×48、透明底的魔法師工程，4 格 idle＋6 格 skill；原生圖層建議 body／equipment／fx，idle 每格 200ms、skill 每格 100ms，存成 `assets/source/mage.pxo`。
3. 關閉再開啟工程，確認圖層、tag、影格時間與內容仍在；只匯入既有 PNG 不足以證明原生可維護性。初始 seed 可以程式產生，但必須清楚標示，再經 Pixelorama 原生保存與真匯出驗證。
4. 先讀所選 binary 的 help，再匯出到 repo 內可清理的 staging 目錄，記 exit code／stdout／stderr；確認實際 JSON 位置與格式。以下命令僅是依官方 help 的候選，尚未實跑：

```sh
"$PIXELORAMA_BIN" --headless --quit -- --version
"$PIXELORAMA_BIN" --headless --quit -- --help
"$PIXELORAMA_BIN" --headless --quit -- \
  --export --spritesheet --json \
  --output assets/raw-export/mage.png assets/source/mage.pxo
```

`PIXELORAMA_BIN` 由執行者明確指定。真實執行時以該版 help／來源碼為準；不要把 Pixelorama 使用者參數誤放到 `--` 前，也不猜 JSON 檔名與 atlas 排列。先建立輸出目錄；清理僅限本 lab 明確產物，不操作使用者其他素材。

5. 對觀察到的 JSON 寫版本化 adapter：檢查來源 hash、輸出存在／非空、48×48 格、10 格、完整 frame rectangle、200/100ms 時序、透明度、標籤與路徑安全，正規化成 SDD 的 manifest。原始輸出另存，禁止硬編碼 fake fixture 充當外部整合。
6. 在最小網頁載入魔法師；重匯出兩次比較解碼 RGBA 與時序。binary 可能寫入時間戳等 metadata，不能只要求整個檔案 bytes 必然相同；但每次檔案 hash 都要記錄。
7. 在 Pixelorama 修改明顯像素／法杖顏色，重匯出、重新載入，截圖核對變化；只有通過這一步才算工具接線成功。再補騎士、射手、治療師。

## 正規化、來源與授權

原稿、原始匯出、web 產物三者分開。`provenance.json`（後續建立）記 asset ID、作者或來源、授權、原稿與輸出 SHA-256、工具版本／binary hash、匯出日期及命令。原創素材明確聲明來源；工具 MIT 與第三方素材授權分開，不使用來源未明的商業角色或音效。

manifest 中路徑只允許本 lab 的相對路徑；拒絕絕對路徑、`..`、遠端 URL 與未知 schema。任何一職業缺圖或資料不合法，驗證命令應非零退出。開發用占位可單獨標為 placeholder，但不得進通過 AC-01/02/06 的證據。

## 證據

每次執行補入 [驗收紀錄](acceptance.md)：source commit、工具版本／hash、精確命令、exit code、原始檔／輸出路徑、解碼像素比較、瀏覽器版本、截圖與限制。CI 驗資料不等於看過動畫，圖片好看不等於原生流程可重現。
