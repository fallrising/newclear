---
project: platform/ice-maker
purpose: 將文件與工程工作轉為保留來源的知識候選及可重建出版物
kind: application
mainline: incomplete
usable_tag: none
reviewed: 2026-10-21
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# Ice Maker 成功契約

## 主線與範圍

[原始 SDD](docs/sdd/00-SDD-OVERVIEW.md)包含規格驅動工作、隔離 runner、多 provider、知識抽取與出版。
Phase 0–7 本機實作 DEVELOPMENT_COMPLETE；普通文件批次及可讀結果已有獨立實作與真 PDF pilot。

知識候選須保留來源及人工審查；publication 是可重建視圖，不能升格為來源真相。
不包含無人核准 production deploy、敏感資料自動外送或對既有 checkout 的直接修改。

本契約核對的是上述來源版本中的文件與程式。
`complete` 只適用明列的主線範圍；沒有延伸為部署或生產保證。

## 驗收條件

下表 `historical` 是既有報告的結果，沒有在 2026-10-21 重跑。
`pending` 保留缺少證據或尚未實作的條件；程式存在不等於通過。

| AC ID | Given / When / Then | 狀態 | 證據或缺少原因 |
| --- | --- | --- | --- |
| AC-01 | Given 合法 SDD 與本機輸出目錄，When init/new/validate 與 publication 重建，Then 規格驗證且 Markdown/HTML 可重現 | historical | [Full build 驗證](specs/active/full-build/verification.md)：188 離線測試與重建旅程 |
| AC-02 | Given 已確認權利的真實英文 PDF，When upload/extract/index/readable-result，Then 81 頁皆有 native text 且重傳保持結果一致 | historical | [2026-10-04 真文件結果](docs/verification/first-real-result.md)：0038175b；未跑 OCR |
| AC-03 | Given 普通文件批次，When 停止／重啟／重傳或單檔失敗，Then 保留 provenance、可恢復並隔離 item failure | historical | [批次驗證](specs/active/production-document-batch/verification.md)、[可讀結果驗證](specs/active/readable-document-results/verification.md) |
| AC-04 | Given 真 runner/provider 與運作環境，When 完成受控工作及安全恢復，Then identity、egress、rotation、restore、cost/telemetry 與人工 gate 均有外部證據 | pending | [Full build](specs/active/full-build/verification.md)：多個 Phase 為 CODE_COMPLETE_EXTERNAL_PENDING |

## 現況與缺口

本機完整開發與 LOCAL_DEV 真文件結果成立；完整原始產品主線仍有 external-pending。
81 頁 pilot 是 native extraction，不是掃描 PDF OCR 準確率證明。
真知識候選仍 unpromoted；草稿 PR 不是知識被接受。
Rootful Docker 下的隔離量測不能當成 rootless production 或 compromised-runner gate。

這次僅新增驗收入口，未改變 runtime 或原有驗收 oracle。
歷史結果若與現行 source 有相關差異，必須補驗而不能直接繼承。

## 啟動與驗證

[Quickstart](docs/quickstart.md)與[文件批次 runbook](docs/runbooks/production-document-ingestion.md)列出 private data root、doctor、固定 parser image 與 loopback upload UI。

已核對入口：[SDD CLI](src/ice_maker/cli.py)與 [Makefile](Makefile)。
下列是該入口既有的啟動或驗證命令，並非本次執行紀錄；
需先完成連結文件中的依賴、設定及適用環境準備。

```sh
make check
PYTHONPATH=src python3 -m ice_maker status --json
scripts/document-ingestion-doctor.sh --json
```

執行後應保留來源 SHA、必要設定的非秘密摘要、命令與結果，
並將 runtime 證據逐項對回 AC；不得只用 health 或 exit 0 宣告全部完成。

## 可用版本

目前 `usable_tag: none`；本次沒有建立或發布任何 tag。
既有版本號、合併紀錄與歷史驗收不自動轉換為可用版本標記。

須將本機結果與完整 runner/provider 運作驗收分開，補齊原規格外部 gate 並核對目標版本；尚不能以單份 PDF 成果宣稱全項目可用。

## T-0383 Grok review-boundary documentation

Goal/scope: clarify the existing AC-04 external gate and actual Grok review invocation; no runtime changes or new capability claim. The artifact is supplied review input, not a filesystem boundary. Verify the runbook against `ClaudeGrokReviewAdapter.build_argv` and `execute_argv`, official Grok docs and independently reviewed source. Run project/index/link checks; no new model call or test asserting an unchanged implementation. See [task board](docs/tasks/BOARD.md). AC-04 remains pending.

## T-0380 FE 第 2 輪 R2-AC-6/E

本次僅依已批准 [DESIGN M1–M4](fe-review/DESIGN.md) 實作 review-only 合成 extractor 啟動器、內嵌上傳頁的外殼／狀態與錯誤處理、固定結果頁換行／導覽。API、批次狀態、SQLite、正式 CLI／OCR／Docker／relay、依賴與 CI 不改。

| AC | 狀態 | 驗證計畫 |
| --- | --- | --- |
| FE-M1 | passed (local) | 真 synthetic upload／結果、固定 seed 重啟身份、health200、shared capture --dry-run／--start 3頁×3尺寸×2偏好；明確 owned cleanup |
| FE-M2 | passed (local) | lang／viewport／main／system colors／focus／stacked fields；三尺寸無 overflow、axe critical/serious 0（coverage/incomplete 如實記錄） |
| FE-M3 | passed (local) | 上傳及poll錯誤可見、停止poll、busy恢復、語言trim、counts／下載；30分鐘 UI poll cap，真流程＋受控故障與clock證據分開 |
| FE-M4 | passed (local) | 固定escaped Markdown外殼／換行／導覽；XSS與末端MAX_HTML_BYTES保留，新增bytes及near-cap回歸 |
| FE-gates | review/CI pending | 帶extras的make check、focused RED/GREEN、browser證據、獨立review與CI／merge |

結果記入 [本次報告](fe-review/tasks/round2/report.md) 與 result.json。完整產品 AC-04、usable_tag 與第3輪仍未驗收。

實際證據：18 shared captures／18 axe scans 通過；原 runtime race FAIL保留，focused flow及completed-only補證通過。原生320 tests有1環境FAIL→原test focused PASS；不冒稱單次全綠，exact-head CI仍必要。
