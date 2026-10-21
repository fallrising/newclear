---
project: platform/local-ocr-services
purpose: 以可獨立部署的本機引擎提供受限且一致的 OCR HTTP 介面
kind: service
mainline: incomplete
usable_tag: none
reviewed: 2026-10-21
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# Local OCR Services 成功契約

## 主線與範圍

[部署規格](docs/specs/deployable-ocr-services.md)定義 CPU-first RapidOCR、Tesseract、Paddle Structure 三個獨立 profile。
共同主線是受驗證 image bytes 經授權與容量准入，得到 v1 結構化結果，且 runtime 不下載模型。

不做公開 SaaS、帳務、GPU、持久工作佇列或模型訓練。
未經代表性資料與目標機量測，不承諾準確率、延遲或跨引擎等價品質。

本契約核對的是上述來源版本中的文件與程式。
`complete` 只適用明列的主線範圍；沒有延伸為部署或生產保證。

## 驗收條件

下表 `historical` 是既有報告的結果，沒有在 2026-10-21 重跑。
`pending` 保留缺少證據或尚未實作的條件；程式存在不等於通過。

| AC ID | Given / When / Then | 狀態 | 證據或缺少原因 |
| --- | --- | --- | --- |
| AC-01 | Given 有效 key 與繁中／英文 image，When 呼叫 RapidOCR 的真 HTTP 服務，Then readiness 與 v1 結果包含正確引擎及文字 | historical | [目標機驗證](docs/verification-target-de1.md)：M2 真引擎／HTTP smoke |
| AC-02 | Given Tesseract chi_tra+eng image，When 提交已知樣本，Then 回應文字 hash、尺寸與 engine identity 符合紀錄 | historical | [目標機驗證](docs/verification-target-de1.md)：M3，繁中與英文 expected_text_hash_match=true |
| AC-03 | Given 缺 key、錯格式或超限請求，When 經共用 API，Then 回應穩定錯誤並維持受限資源與非 root 容器 | historical | [目標機驗證](docs/verification-target-de1.md)：38 contract tests 與容器限制檢查 |
| AC-04 | Given Paddle Structure 及代表性負載，When 在目標機驗證表格／版面與容量，Then 三 profile 的功能與資源門檻皆有量測 | pending | [目標機驗證結尾](docs/verification-target-de1.md)：Paddle NO-GO；M4 未跑，S-010/011 pending、S-016 blocked |

## 現況與缺口

RapidOCR/Tesseract 有真實目標機 smoke，但結論仍為 CONDITIONAL。
Paddle 的 NO-GO 是容量判定，不能改寫為已支援生產的第三引擎。
M4 工具候選未接受，沒有 benchmark、saturation 或代表性品質結果。
歷史文件標 CURRENT 是 2026-09-04 當輪；本契約全部按歷史證據引用。

這次僅新增驗收入口，未改變 runtime 或原有驗收 oracle。
歷史結果若與現行 source 有相關差異，必須補驗而不能直接繼承。

## 啟動與驗證

[README](README.md)提供 .env key、Compose profile 與 raw bytes curl；[operations](docs/operations.md)記錄容器與模型邊界。

已核對入口：[HTTP app](src/ocr_service/app.py)與 [Makefile](Makefile)。
下列是該入口既有的啟動或驗證命令，並非本次執行紀錄；
需先完成連結文件中的依賴、設定及適用環境準備。

```sh
make check
docker compose --profile rapidocr up --build -d
curl http://127.0.0.1:8011/health/ready
```

執行後應保留來源 SHA、必要設定的非秘密摘要、命令與結果，
並將 runtime 證據逐項對回 AC；不得只用 health 或 exit 0 宣告全部完成。

## 可用版本

目前 `usable_tag: none`；本次沒有建立或發布任何 tag。
既有版本號、合併紀錄與歷史驗收不自動轉換為可用版本標記。

須完成代表性資料與容量量測，處理 Paddle 的具體阻擋，並為目標 image/source 建立驗收；兩個 conditional smoke 不足以標記完整三引擎主線。
