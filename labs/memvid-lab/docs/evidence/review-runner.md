# Memvid lab runner 獨立審查

STATUS: ACCEPT

Reviewed: 2026-10-28T11:40:54Z

本次審查由未撰寫下列 runner／CI 檔案的 sub-agent 執行。結論限於本頁列出的五個檔案及其 CLI／報告邊界；沒有阻擋 finding。這不是全專案驗收、遠端 CI 通過或合併批准。

## 審查範圍與版本

| 檔案（repository 相對路徑） | SHA-256 |
| --- | --- |
| `labs/memvid-lab/lab.py` | `1fb777d22e302206f968cf8cf8206ee7c485c71f01aae38eac0b8f7cf8b918ff` |
| `labs/memvid-lab/offline.py` | `dc325a1466950893319d8fd349538d62ce6e47f491bcf648e06ab86dc2183b9c` |
| `labs/memvid-lab/Makefile` | `97b82128f67024e16d499db4451ec682f17158bb389fde67bc7ffa3cd7ebf8f1` |
| `labs/memvid-lab/tests/test_cli.py` | `44481e8a92ec413fc9fe232b95a7eae783a58278f517a5d0b51e13de39417e05` |
| `.github/workflows/memvid-lab-ci.yml` | `329bfcf383a4ba5722657724006efca86aa08b4fc583733d0981792f6b0aaf3b` |

未審查 `scenarios.py`、`advanced.py`、`models.py` 的實作／oracle，也沒有在本次 runner 審查重跑 native Whisper 推論。CLI regression 會間接執行 core 案例；這不代表那些案例的原始碼或驗收 oracle 已由本 reviewer 審核。Native helper 的作者驗證與另一 reviewer 複驗屬不同紀錄，不能併入本頁的獨立 code review 範圍。

## 最後變動核對

- `upstream_reading_commit` 已明確表示閱讀基準，避免把目前 upstream main 誤作官方 crate／binary 的編譯來源。
- Whisper verification 的報告輸出只取 `overall_status`、`checks`，不輸出 SDK 的 `file_path`。完整性成功判定與 reopen 行為仍保留。
- 缺少模型的 regression 加上精確 `{"passed": 12, "blocked": 3}` 斷言，防止其他 core 失敗被三個 blocked 項掩蓋。

前兩項在前次審查收尾擷取 SHA 時已落地，因此 `lab.py` 的前後收尾 SHA 相同；本次再次閱讀核對。`tests/test_cli.py` 移除新增的 counts 斷言後，其 SHA 與前次版本 `b18afe8054af2aca2189c91c2ae389235a0ac689255b85333e2dbf1d1b693abb` 完全相同。其餘三個受審查檔案的 SHA 未變。

## 審查判斷

1. **離線邊界有效且失敗時不降級。** CLI 先清除隱式 API 設定、安裝 seccomp，再 import `memvid_sdk`。禁止 `socket`、`socketpair`、`connect`、`sendto`、`sendmsg`、`sendmmsg`，後續程序與 native threads 繼承限制；缺少 Linux／libseccomp 即失敗。此邊界用於本實驗 runtime，不宣稱是可執行敵意程式的通用 sandbox。
2. **Full profile 不將缺模型視為成功。** 案例例外記為 `blocked` 或 `failed`，完整執行以非零結束；只有全部案例 passed 才得到 `full_acceptance_passed: true`。Core profile 將未選模型案例記為 `not_run`，並保持 full acceptance false。
3. **輸出與報告不冒充完成。** 既有 output directory 被拒絕，configuration failure 不在其中寫入假報告。逐案例記錄實得結果、錯誤和狀態，沒有吞例外轉成 pass 的邏輯。
4. **Query 使用真正唯讀 SDK。** `sdk.use(..., read_only=True)` 搭配 lexical 查詢；不存在的 memory 不建立，未知 query 不編造來源。合法與非法 `k` 有明確邊界。
5. **Whisper 整合驗證實得資料。** 檢查資產雜湊、engine／patch 標記、轉錄內容與時長，將實際 stdout 的 text 寫入 Memvid，驗證命中、無命中、完整性與 reopen。三個 token guard 負例亦已接入 full path；此處審查呼叫與判定流程，沒有重跑推論。
6. **CI 沒有遮蔽失敗或擴大權限。** Python 安裝要求 hashes，Rust 版本固定；完整模型準備後執行 full profile，沒有 `continue-on-error`。`always()` 上傳報告不會使先前失敗轉成成功。Workflow 具 path filters、contents-read、checkout 不保留 credentials、timeout 與 concurrency，沒有部署／發布步驟。

## 獨立執行結果

在 Python 3.12.14、Memvid SDK 2.0.160／core 2.0.140 環境，從元件目錄執行；`PYTHON` 指已準備的虛擬環境 Python，不在公開證據記錄宿主絕對路徑。

```sh
PYTHONDONTWRITEBYTECODE=1 "$PYTHON" -m unittest discover -s tests -v
```

結果：**8 tests，8 passed，0 failed，0 skipped，4.138 秒**。

| Regression | 結果 |
| --- | --- |
| 損壞 memory 失敗 | passed |
| 既有 output 不修改 | passed |
| Full 缺模型：12 passed／3 blocked、exit 1、full acceptance false | passed |
| 不存在 memory 不建立 | passed |
| 子程序繼承網路拒絕 | passed |
| 唯讀 query 保留來源及檔案雜湊 | passed |
| 損壞模型拒絕且不修復／覆寫 | passed |
| 未知 query 不虛構來源 | passed |

前次獨立 CLI 探勘也以真 SDK 新建另一份合成 fixture，實際核對以下行為。最後的報告欄位調整未改動這些 query／network／overwrite 路徑；以下保留為前次觀察，不冒充本次重跑：

| 獨立探勘 | 觀察 |
| --- | --- |
| `info` | SDK 2.0.160、core 2.0.140；wheel `whisper: false` 如實顯示 |
| `network-check` | IPv4／IPv6 均 `EPERM` |
| 正向 query | 正確 URI 與內容，`.mv2` SHA-256 不變 |
| Query 前後目錄 | 沒有新增 sidecar |
| 未命中 query | 空 hits |
| `-k 0` | exit 2、stdout 空 |
| 既有 output sentinel | exit 2，內容及檔案清單不變 |
| seccomp 後啟動 IPv6 UDP 子程序 | 子程序 socket 被拒絕，`EPERM` |

## 作者完整執行報告的一致性核對

[full-run-before-sales-review.json](full-run-before-sales-review.json) 是主控的實跑報告，完成時間為 `2026-10-28T11:38:31.282071+00:00`；記錄 **15／15 passed**、`full_acceptance_passed: true`。本 reviewer 只核對該報告的數量、旗標及其中 **15 個 runtime source SHA-256** 全部與該次核對時的檔案一致，未重跑 full model profile，也未因此把這 15 個檔案列為已做 code review。

報告 SHA-256：`ca286254067589dd1b1d8831138cf44b425206ffd8f48ddd0301d69ba427c962`。

本頁只新增審查紀錄，沒有修改實作。遠端 CI 結果、場景 oracle 審查與整體交付由主控另行核對。

主控交付註：後續依另一 reviewer 補齊 UC07 的產品文件 oracle，未修改本頁五個受審檔案；新的完整執行見 [full-run.json](full-run.json)，UC07 的最終來源審查見 [core/native review](review-core-native.md)。本頁原執行報告以原 SHA 的快照保留。
