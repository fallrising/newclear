# 驗證計畫

本頁為 [SDD](../SDD.md) AC-101–106 的**後續計畫**，尚未執行。M0 實際完成的文件檢查另見 [M0 證據](evidence/m0-document-review.md)。

## 1. 先建立原版參考路徑

M1 開始時選定一台可用 Apple Silicon 設備，記錄 OS／晶片／GPU／記憶體、compiler、SDK、電源與其他 GPU 工作條件。型號及 RAM 尚未指定，不把研究教學的 M1 Max／M3 Max 機器當作目標機。按 [lock](../upstream.lock.json) 取得乾淨固定引擎及模型，先完成原版單張 txt2img，確認 CLI 參數、模型載入、輸出尺寸、tokenizer 與 Metal 的可觀測訊號。

參考試跑若失敗，保留確切版本、命令、錯誤及缺項，先修復該阻擋原因；不能以換成另一模型或 CPU 成功取代原 Metal 主線。每個新 backend 都重做自己的來源、依賴與實機驗收。

## 2. 主路線與證據

| 步驟 | 操作／輸入 | 觀察與通過條件 | AC |
| --- | --- | --- | --- |
| 準備 | 固定 engine checkout；固定模型 revision；完整檔案清單、來源 digest（LFS SHA-256／一般 Git blob OID）與本地 SHA-256；建置 Metal | checkout 乾淨、source SHA 一致、完整性核對通過、binary digest 與工具鏈 receipt 完整 | AC-101 |
| 檢查 | doctor 讀取明確 profile | 環境／版本／檔案／輸出缺項清楚；不安裝、不下載、不寫模型 | AC-101 |
| 單張生成 | SDD 的合成 mug prompt、seed 42、512×512、4 steps、guidance 1.0 | 真實 Iris exit 0；可解碼 PNG；尺寸一致；結果 JSON 與 artifact hash 一致；沒有成功／失敗混淆 | AC-102 |
| Metal 核對 | 保存上游可靠的 backend／stage 訊號，必要時使用平台原生觀測 | 不能只以 make target 或請求值證明 GPU 使用；訊號不足時 effective_backend unknown 且該驗收 pending | AC-102 |
| 重跑 | 同環境 1 cold、2 warm；每次新 run ID | 固定版本／參數一致；逐次時間、資源量測方法與結果可核對；變異如實記錄 | AC-105 |
| 依賴隔離 | 使用已準備 binary／權重／原生 libraries 的受控推論環境 | 不靠 Python／PyTorch／Diffusers 完成真實生圖；不要刪除主機 Python，以隔離環境與依賴觀測證明 | AC-106 |

每次保存已驗 model manifest、build receipt、request、result、PNG 與有界 logs。公開報告使用合成 prompt 和匿名環境描述，不包含主機名、個人路徑、tokens 或私人內容。runtime 原始資料不提交本 repo；公開證據記可重現命令與必要摘要，所引用 artifact 必須有真實 digest 及可讀取位置。

## 3. 負例與程序生命週期

| 案例 | 必須觀察到的結果 |
| --- | --- |
| 缺欄位、重複 key、未知欄位、超長 prompt、非法尺寸／seed／timeout、錯模型／backend | `invalid_request`；推論未啟動，不能只測假 runner 的成功回應 |
| 缺 text encoder shard、錯 revision、digest mismatch、損壞權重 | `model_incomplete`／`source_mismatch`／`integrity_failed`；推論前拒絕 |
| run ID 已存在、目標 symlink | `output_exists` 或確切 IO 錯誤；既有內容 digest 不變 |
| 兩個 wrapper、不同 output-root／profile 路徑但相同裝置 | 第二個回 `busy`；不能靠改輸出目錄繞過鎖 |
| 原生程序非零退出／沒有 PNG／壞 PNG／錯尺寸 | `process_failed` 或 `invalid_output`；沒有成功 artifact |
| 正常運行中取消／短 timeout | 只終止自己的程序群組，期限內 reap，鎖釋放，failed／cancelled 收據正確 |
| 在提交前終止程序、留下 partial | 殘留不被讀成成功；後續明確報告，不覆寫或自動刪除別人的資料 |
| 結果目錄不可寫／磁碟不足 | 非零 exit、stderr 可判讀；不宣稱收據已落盤 |

輕量 fixture 可用於輸入／檔案／程序錯誤分支；成功主線與真實取消／timeout 仍要使用固定 Iris 及真模型驗證。fixture 不取得 GPU、速度、畫質或模型完整性通過資格。

## 4. 量測口徑與畫面檢查

cold 指明確記錄的首次執行與快取狀態；warm 指同樣的 binary／模型在相同環境接續執行。不能為了測 cold 未經說明清除整台機器 cache。開始／結束以 UTC 記錄，時長用單調時鐘；wrapper 總時間與上游 engine 分段時間分欄，不把後者冒充端到端時間。

每次記錄 wall time、成功與否、輸出大小，及實際可取得的 CPU RSS／統一記憶體／GPU 指標和工具。未量測欄位填 null／unknown 並寫原因；不同語義的數字不相加。三次樣本只可作試跑摘要，不宣稱 p95、穩定吞吐或所有硬體效能。

圖片除格式外需人工確認非空白／嚴重破損，並檢查合成 prompt 中主要物件。原版參考圖、wrapper 輸出與後續重跑的差異各自保存；同 seed 的像素差異不可直接當錯誤，也不能忽略明顯失真。任何數值畫質容忍門檻在取得原版參考與合理基準後、正式驗收前審查固定，不能沿用任意網路文章秒數或上游單一測試的通用閾值。

## 5. 結案格式

下一階段結果至少列：來源 SHA／model revision／manifest digest、實際環境、每個 AC 的 passed／failed／pending、命令與 exit、artifact digest、量測口徑、未跑原因、PR／CI／審查連結。只通過文件或 wrapper fixture 時，AC-102、AC-104 的實機部分、AC-105、AC-106 仍保持 pending。

首要主線完成後才評估 Linux、WSL2、其他模型與 img2img。M0 不替後續階段預先填入通過狀態。
