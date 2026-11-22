# Portfolio：Ice Maker 本機 OCR 與 HTTP 服務比較（P03）

**目前維持本機 Poppler／Tesseract pipeline。** Ice Maker 已有 native、掃描及混合 PDF
路徑；未選用 HTTP consumer 不阻擋這些既有能力。HTTP OCR 是候選接合方式，尚無
同一代表性語料上的品質或容量收益證據，不能因服務存在就建立必做 adapter。[Ice AC][ice-ac]、[OCR AC][http-ac]

本頁只比較來源、差異與採用條件；不替換 parser、不上傳私人語料、不新增授權或部署。
本輪範圍與驗證見[任務](tasks/P03.md)。

## 基準、證據層次與既有成果

來源固定為 newclear `1c642259957aed8f65c31dc45f77740a121d9aa4`（2026-11-22 核對）。
與原規劃 `2aa21f10b53ecaeb079279b6531bbb47a103e937` 相比，Ice Maker 與 Local OCR
Services 樹無差異。下列**來源事實**是該版本契約／程式；**歷史證據**只適用原樣本與
記錄的執行版本；**現況未知**不由日期或曾經成功推定；**提案**仍須後續具名需求與驗證。
原件及身份留在私有來源，不在本文件重現。兩邊現有文件沒有完整的欄位與失敗語義對照，
因此補本頁；原 SDD、AC、cache 與 runtime 仍是權威。

| 歷史證據 | 可支持的結果 | 不可外推的結論 |
| --- | --- | --- |
| 本機十文件 pilot，含9頁掃描PDF與37頁native PDF | 真 Poppler／Tesseract；10/10處理，37/37 native頁與5,973 normalized characters吻合；掃描章節標題21/22，座標無越界；掃描平均confidence 0.586 | 不代表正文／code／表格品質已通過；樣本有限，confidence不是準確率。[批次驗證][batch-evidence] |
| 同一保留pilot的可讀結果 | 10文件、54頁、16,168 chunks可重建；有5,405個低confidence review markers；Markdown／HTML有上限且可重現 | 不是新獨立語料，也不是layout-perfect表格、摘要或知識被接受。[可讀驗證][read-evidence] |
| 81頁英文PDF，原code `0038175b9a82a98c02fb9b64688cae243e9f2ad3` | 81/81為native text；修正`-layout`閱讀順序，重傳／成果一致，人工看過12頁；候選仍unpromoted | **零OCR頁，不是OCR證據**；parser／operator非root但daemon rootful，不是rootless production驗收。[真文件紀錄][native-evidence] |
| 生成70-PDF／30-image測試 | 100項的控制流程：97 processed、1 duplicate、1 rejected、1 failed，恢復與界線可測 | deterministic extractor seam不是100份代表性真文件品質／容量benchmark。[批次驗證][batch-evidence] |
| HTTP RapidOCR／Tesseract | 原AC-01–03記錄真引擎／HTTP smoke及安全契約歷史證據，結論CONDITIONAL | 不是已比較Ice語料的改善；Paddle容量NO-GO，M4／代表性品質與saturation未完成，AC-04 pending。[HTTP AC][http-ac] |

本輪沒有重跑這些流程，也未查核當前服務存活或目標機容量。兩邊 `mainline: incomplete`、
`usable_tag: none` 保持；原 Ice AC-04 與 HTTP AC-04 不會因 P03 文件合併通過。

## Provenance 與座標：不是直接換 URL

| 欄位／語義 | Ice Maker 現有本機契約 | HTTP OCR v1 契約 | 接合差異與處理決策 |
| --- | --- | --- | --- |
| 原件hash | descriptor／chunk綁原PDF或原image的SHA-256 | API接raw image bytes；回應有request_id，沒有原PDF／原件hash欄位 | caller必須保留原件identity與精確送出的bytes hash；request_id不能代替內容hash或去重保證。本輪未建立mapping。[extractor][extract]、[HTTP models][http-models] |
| 1-based頁碼 | PDF按物理頁1..N產生逐頁證據；混合頁保留method | 單張raster API，region／block的page預設1 | 單張image的page=1不是原PDF第1頁；若未來逐頁／tile呼叫，需明確映射回原件物理頁。HTTP不是多頁PDF parser。[extractor][extract]、[API][http-spec] |
| raster hash | PDF OCR頁保存Poppler產生PNG bytes的hash與尺寸；native頁的raster欄位為None | image尺寸有回傳，但沒有raster hash欄位 | 不能把PDF原件hash、rendered PNG hash、重新編碼／EXIF轉向後bytes混為一個hash；變換需另存來源與對應，不能假裝現有wire已提供。[extractor][extract]、[models][http-models] |
| EXIF後尺寸／座標 | `_pillow_decode`讀取原解碼size並copy；未做EXIF transpose。長圖tile word box回到該image座標；PDF OCR回到rendered raster座標 | 先EXIF transpose再推論；尺寸及四點polygon在轉向後image座標，clockwise、左上起點 | 兩邊可能width／height互換或旋轉。不得直接拿HTTP座標疊回原未轉向圖；須固定轉換與邊界測試，且重新綁定證據／cache。本輪只記缺口。[local decode][extract]、[HTTP decode][http-image]、[API][http-spec] |
| region粒度 | Tesseract TSV word級rectangle；native用normalized text offset／length，沒有像素box | 所有引擎text regions為line級polygon；Tesseract words先group成line；layout blocks另列 | line polygon不能冒充逐word box，native offset也不是像素。縮成矩形會丟幾何資訊；需要另批語義與驗收，不能靜默套現有chunk schema。[本機FR][batch-spec]、[可讀FR][read-spec]、[API][http-spec] |
| engine／version／cache | extractor semantics版本、Poppler／Tesseract版本、config digest、語言組合及原件hash共同綁cache；v3不重用v2 | engine.name／version／model、schema_version與elapsed_ms | engine欄位提供身份描述，不是完整image／model checksum或外部服務attestation；切引擎／方向／模型／語言策略需新版本binding，不能污染原immutable cache。[FR-7][batch-spec]、[API][http-spec] |
| nullable confidence | OCR word是有限[0,1]數值，頁為word平均；native固定1.0是本機契約標記 | confidence是[0,1]或null，缺少時不虛構數值 | 不可把null補0或1以通過現有schema，也不可把native的1.0或不同引擎分數當同等準確率。接入前須明訂缺值／review／聚合語義；目前不改schema。[extractor][extract]、[models][http-models] |
| readable／structured輸出 | 本機escaped HTML與bounded Markdown，保留來源，低confidence標記；非表格還原 | Paddle可附blocks／Markdown，但Markdown可能含inline HTML，視為不可信 | 不直接渲染HTTP Markdown；仍需consumer escaping／sanitization與來源綁定。Paddle未資格化，不把optional欄位當已驗收功能。[可讀FR][read-spec]、[API][http-spec]、[HTTP AC][http-ac] |

## 文件種類、失敗與停止

| 情境 | 現有本機行為 | HTTP 候選與不能假設的等價性 |
| --- | --- | --- |
| 文字PDF | 逐頁`pdftotext -layout`後normalize；達到既有最少20 UTF-8 bytes門檻才走native | raw image介面不取代native extraction；保留native路徑，不把全部文字PDF轉OCR。[extractor][extract] |
| 掃描／混合PDF | 只對無足夠可用native text的頁rasterize＋OCR；同一PDF可同時有pdf-text／ocr | 若未來選HTTP，PDF頁數、rasterization、原件／頁碼binding仍由Ice保留；服務不能從單張圖重建原PDFidentity。[FR-3][batch-spec] |
| 錯誤文字層 | malformed UTF-8／unsafe非空text拒絕，不能藉OCR fallback繞過；但安全且超過門檻的錯誤內容可能仍被選native | **目前沒有語義正確性判別或已批准的自動強制OCR修復**。先以具名樣本證明錯誤與收益；HTTP可運作不表示已解決這項品質問題。[`_native_pdf_text`][extract] |
| 空頁／沒有辨識文字 | 可fallback OCR；合法empty TSV row可忽略，但全頁無accepted words會報`OCR produced no words`，PDF不發布partial evidence，批次隔離item failure | HTTP schema允許空regions；這不代表可映射成本機processed／empty-page成功。空白與未辨識要分清，不把null／空陣列冒稱完整結果。[extractor][extract]、[models][http-models] |
| 超限／格式錯誤 | 原batch、file、page、decoded pixels、tile、output、subprocess時間等上限與fail-closed保留 | HTTP預設10MiB、25M pixels、axis16384；body／signature／decoded-image分層拒絕，不接URL、不接PDF。長圖整張可能被拒，不能為接服務抬高原上限。[本機NFR][batch-spec]、[API][http-spec] |
| 容量／排隊 | 本機有受限workers及持久checkpoint；代表性吞吐仍未驗收 | HTTP admission限制running+waiting，滿額讀body前503，等待inference slot超時503；單container預設一個inference、一個waiting。HTTP成功／health不是吞吐或成本改善證據。[API][http-spec] |
| 取消／斷線／停止 | 保留既有batch interruption、atomic progress及明確stop／resume流程；不新增立即停止或HTTP同等性承諾 | coroutine取消可釋放admission，但**CPU worker thread未結束前不得釋放inference slot**；`shield`與done callback保留該界線。斷線不代表推論已停，不可立即無界retry或加派工作。[本機runbook][runbook]、[HTTP concurrency][http-concurrency] |
| 重試／恢復 | 只重用完整驗證且inputs一致的cache；既有completed uploads不可改寫；品質重跑用新的private state保留舊證據 | request_id不是durable job或idempotency ledger；HTTP無持久queue。需界定有界retry、未知worker與新attempt證據，本輪沒有實作adapter或重送。[FR-7][batch-spec]、[API][http-spec] |

## 決策與具名後續門檻

1. **保留本機 pipeline**：現有9頁掃描／37頁native、長圖及可讀成果都保留。
   HTTP等待、Paddle NO-GO或平台整合未完成，不是停用既有掃描功能的理由。
2. **品質候選問題已具名，收益尚未知**：掃描pilot的平均confidence 0.586及正文／code／表格
   待人工確認，可形成未來比較題目；不是RapidOCR一定更準的證據。81頁native閱讀順序問題
   已由`-layout`修正，不能再次包裝成必換HTTP的理由。[批次驗證][batch-evidence]、[native紀錄][native-evidence]
3. **容量候選仍缺實測**：HTTP拆分runtime可作架構選項，但沒有Ice代表性request mix、
   latency／throughput／memory／saturation與可靠性收益。Paddle不是已可用的第三引擎。
   無具名且量測成立的收益，就不建立adapter、不搬服務。[HTTP AC][http-ac]
4. **未來比較提案，非本輪執行**：先由owner確認樣本權利／data class、語言、正文／表格
   判定標準及容量目標，再於批准的目標環境固定source／image／模型檔digest與同一樣本。
   私有原件／識別資訊／全文仍在本地；「operator自管HTTP」不自動等於允許外送。
   只有代表性結果支持收益且上述欄位／失敗映射有驗證，才另立接入範圍。[原規格OQ／NFR][batch-spec]

原來的**代表性100份真文件（70 PDF／30 image）、正文／表格品質門檻、rootless且network-disabled
目標runtime**仍需原有外部證據。十份pilot、生成100項測試、兩個HTTP smoke或P03文件
都不替代它們。即使將來接HTTP，也必須先解決parser network-none與通信邊界的設計衝突，
不能為連服務直接放寬既有egress；本輪不改網路或授權。[批次驗證][batch-evidence]、[可讀驗證][read-evidence]

回退僅撤回本頁及新增導航／比較提案；原AC、原件、cache、index、身份、parser與服務都在原位。
沒有新增外部副作用，也不聲稱文件回退能消除既有未知副作用。Knowledge promotion仍由原人工gate決定。

[ice-ac]: https://github.com/fallrising/newclear/blob/1c642259957aed8f65c31dc45f77740a121d9aa4/platform/ice-maker/SUCCESS.md
[http-ac]: https://github.com/fallrising/newclear/blob/1c642259957aed8f65c31dc45f77740a121d9aa4/platform/local-ocr-services/SUCCESS.md
[batch-evidence]: https://github.com/fallrising/newclear/blob/1c642259957aed8f65c31dc45f77740a121d9aa4/platform/ice-maker/specs/active/production-document-batch/verification.md
[read-evidence]: https://github.com/fallrising/newclear/blob/1c642259957aed8f65c31dc45f77740a121d9aa4/platform/ice-maker/specs/active/readable-document-results/verification.md
[native-evidence]: https://github.com/fallrising/newclear/blob/1c642259957aed8f65c31dc45f77740a121d9aa4/platform/ice-maker/docs/verification/first-real-result.md
[extract]: https://github.com/fallrising/newclear/blob/1c642259957aed8f65c31dc45f77740a121d9aa4/platform/ice-maker/src/ice_maker/production_extraction.py
[http-models]: https://github.com/fallrising/newclear/blob/1c642259957aed8f65c31dc45f77740a121d9aa4/platform/local-ocr-services/src/ocr_service/api_models.py
[http-spec]: https://github.com/fallrising/newclear/blob/1c642259957aed8f65c31dc45f77740a121d9aa4/platform/local-ocr-services/docs/specs/deployable-ocr-services.md
[http-image]: https://github.com/fallrising/newclear/blob/1c642259957aed8f65c31dc45f77740a121d9aa4/platform/local-ocr-services/src/ocr_service/image_io.py
[batch-spec]: https://github.com/fallrising/newclear/blob/1c642259957aed8f65c31dc45f77740a121d9aa4/platform/ice-maker/specs/active/production-document-batch/spec.md
[read-spec]: https://github.com/fallrising/newclear/blob/1c642259957aed8f65c31dc45f77740a121d9aa4/platform/ice-maker/specs/active/readable-document-results/spec.md
[http-concurrency]: https://github.com/fallrising/newclear/blob/1c642259957aed8f65c31dc45f77740a121d9aa4/platform/local-ocr-services/src/ocr_service/concurrency.py
[runbook]: https://github.com/fallrising/newclear/blob/1c642259957aed8f65c31dc45f77740a121d9aa4/platform/ice-maker/docs/runbooks/production-document-ingestion.md
