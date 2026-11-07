# M4結果：分數加差距能拒答，但保留的正確答案太少

固定M4完整實驗已完成，事前選定的primary **不建議直接採用**。相似度與前兩名差距不足以可靠分辨「相關筆記」與「筆記中真的有答案」；本次沒有根據保留集改門檻或新增策略。工程交付與必要CI狀態見[任務板](tasks/BOARD.md)。

## 事前固定與選擇

[規格](notes-rejection.md)、兩組各24筆／48題的新資料及hash於commit `b3b420d81e9b97818585aa51c5ec7998eca92a35`凍結，早於首次M4推論。每組24個單一gold有答案題、24個無答案題，後者包含各8個無關主題、近似實體、缺少屬性。獨立作者未讀模型結果；root逐題核對後才執行。兩人都能看見兩split，這不是雙盲或代表性流量樣本。

每模型的score_only／score_margin只由dev挑選。完整20,604個grid候選與primary選擇在[calibration](evidence/rejection-calibration.json)，SHA256 `e12fd543e044cf6ae5e18bbf0f36366611579feba096587035af9311ac3b3573`。校準於2026-10-30T10:30:04.105824Z保存，heldout首job於10:30:04.186370Z才開始；完整run10:29:55.722837Z–10:30:15.689899Z。4quality＋2update jobs，0errors，exit0；exit0表示實驗完成，不表示可採用。

## 品質

最多返回原生第一個來源，否則空集合；不生成答案、不重排或補搜。下表為heldout，每列有答案24題、無答案24題；單一gold的hit rate亦為MRR@1，與M3每hit過濾的Recall@5不混稱相同指標。

| 模型／策略 | dev選定t／g | dev正確返回 | heldout正確返回 | heldout來源precision | 無答案誤回 | 全部題拒答比例 |
| --- | --- | --- | --- | --- | --- | --- |
| BGE score_only | 0.85／0 | 1/24 | 0/24 | null（無返回） | 0/24 | 48/48 |
| **BGE score_margin（primary）** | **0.79／0.31** | **4/24** | **1/24（4.17%）** | **1.0** | **0/24** | **47/48（97.92%）** |
| E5 score_only | disabled | 0/24 | 0/24 | null | 0/24 | 48/48 |
| E5 score_margin | disabled | 0/24 | 0/24 | null | 0/24 | 48/48 |

E5兩family在dev沒有任何「至少返回一題、precision1且未知誤回0」的grid候選，因此依規格停用；其零誤回不能當成成功。BGE margin在dev保留最多正確題，故事前選為primary；heldout只保留1個exact題，其他正類別皆未保留，低於hit_rate≥0.90／MRR≥0.80門檻。所有策略仍do_not_adopt_directly。

不拒答的原生top1對照：dev兩模型24/24有答案題正確，但24/24無答案題也返回來源；heldout BGE22/24、E524/24正確，兩者未知誤回仍24/24。Raw共192次query／960hits，來源完整性1.0。請求使用mode=sem與真query vectors；SDK回報的engine字串為hybrid，JSON如實保留requested_mode和native_engine，不將標籤改寫為vector-only。

零誤回僅描述這24個unknown。不能以犧牲幾乎全部有答案題的涵蓋率宣稱品質改善或產品可用。M3原失敗與結果保留，M4是新資料／新query-level決策，不能把兩輪比率當成同一測試集的提升。

## 來源、更新與成本

兩個真模型都透過既有hash-pinned SDK/core/HNSW本地patch寫入／seal／verify／重開；新舊來源current view、按frame刪除與新程序重開均通過。這不是上游已發布修復。新建native library SHA256 `4cb42fa72a2b2802db978bc7125d95ebbc62ff35a955d34b50fa29f4b6fa0038`，source／lock／model pins未變；不宣稱和不同建置路徑的M3 binary逐byte相同。

Heldout BGE／E5文件embedding分別0.192／0.282秒，write-seal-verify0.983／0.876秒；48題batch encode0.307／0.269秒。Native search含完整來源核對p50/p95分別0.253/0.307ms與0.154/0.209ms，不含encode或open。Primary拒答policy逐題驗證＋決策p50/p95為0.00325/0.00539ms；dev全grid校準0.147秒。完整samples、階段耗時、bytes及向量見[報告](evidence/rejection-evaluation.json)，SHA256 `95c576c67b944a1bee3d02a61875fc0ed8c3ca541821d3cbda7b3cb43dde35c0`。這是共用CPU一次小樣本，不能外推production；本輪未重跑M3的100／1000成本曲線。

## 重現與驗證

```sh
make setup
make semantic-sdk
make semantic-prepare
make check
make rejection RUN_DIR=work/rejection-new
```

每次使用新輸出目錄。前置環境仍需要Rust1.90、C/C++與OpenSSL development headers；本機缺headers／unversioned linker names的初次build失敗與修正見[開發紀錄](evidence/rejection-development.json)。只在worktree解壓同runtime版本headers與建立指向既有libssl.so.3/libcrypto.so.3的連結，沒有系統安裝、依賴升級或SDK source修復。

`report.json`含raw來源、向量、決策原因與selected policies；`calibration.json`保存所有候選與事前primary。`rejection_policy.decide(hits, policy)`是無gold參數的純決策入口。已存在輸出／改動固定資料／缺資產為非零錯誤；不是正常拒答。Runtime job失敗保留partial報告；品質低分仍完整輸出採用判斷。

本機53tests＋py_compile、core12passed及repo indexes/workflowlint已通過；core的3個未選模型場景明示not_run，完整15場景、原M3品質與24／1000控制及本M4必須在必要CI通過。[T-016獨立審查](../.team/reports/T-016.md)已接受實作與記錄：重算20,604候選、960hits／cosines、8個policy結果及來源／時間／成本。必要CI與正常Git交付完成前，任務板保持in_progress。沒有產品整合、release/tag/deploy。
