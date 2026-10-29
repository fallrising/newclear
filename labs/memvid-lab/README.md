# Memvid lab

固定版本 Memvid 的場景實跑專案：11 類官方 use case 的記憶層，加上 PDF、本地文字語意搜尋、真實 CLIP 圖片搜尋及原生 Whisper 轉錄入庫。
狀態與逐項驗收見 [SUCCESS.md](SUCCESS.md)，設計見 [SDD.md](SDD.md)，來源與官方範例差異見 [upstream.md](docs/upstream.md)。
文檔檔位未分級；本次是 owner 指定的有界實驗。

2026-10-28 本機完整實跑 **15／15 通過**，CLI 邊界 **8／8 通過**；細節及原始失敗見 [執行紀錄](docs/evidence/README.md)。
原場景實驗已於 2026-10-28 合併（[功能 #709](https://github.com/fallrising/newclear/pull/709)、[結案 #733](https://github.com/fallrising/newclear/pull/733)）；四項 CI 通過，八項 AC 結案。`usable_tag: none`，未部署。

2026-10-29 owner 批准接續 [T-0436 繁中筆記可用性評估](docs/notes-usability.md)：M1 同步狀態，M2 量測檢索、來源、更新與規模成本。這是獨立後續里程碑，原場景實驗的完成範圍不變。

## 執行

已驗證平台為 Linux x86-64、Python 3.12.14。runtime 需要系統 `libseccomp`。
完整模型路徑另需 Rust 1.90.0、C/C++ build tools 與 OpenSSL development headers/libraries。
使用真實 `memvid-sdk==2.0.160`／native core `2.0.140`，不需要模型 API key。

從此目錄執行：

```sh
make setup
rustup toolchain install 1.90.0 --profile minimal
make prepare
make check
make full RUN_DIR=work/demo-001
```

`setup` 從兩份 hash lock 安裝 Python 依賴。`prepare` 下載固定版本、SHA-256 核對的模型與公開 fixtures，
並建置 [原生 Whisper helper](native-whisper/README.md)。模型與 fixtures 合計約 491 MB，工具鏈及 build cache 另計。
這兩步需要網路；準備完成後，`full` 於匯入 SDK 前禁止程序與其子程序建立／傳送網路流量，
IPv4、IPv6 都實際測試為 `EPERM`。規則只作用於該程序，不變更主機防火牆。

每次使用新的 `RUN_DIR`；既有目錄會被拒絕。輸出包含各案例的 `.mv2`、PDF／圖片 fixtures 和 `report.json`。
完整 profile 必須 15 個案例全數通過，才會標示 `full_acceptance_passed: true`；缺少模型、功能錯誤或內容不符合都以非零結束。

不準備模型時可先跑 12 個核心案例：

```sh
python3 -m venv .venv
.venv/bin/python -m pip install --require-hashes -r requirements.lock
make core RUN_DIR=work/core-001
```

這條路徑把三個模型案例標為 `not_run`，不代表完整驗收。

## 查詢實驗產出的記憶

```sh
.venv/bin/python lab.py query work/demo-001/uc-01/uc01-agent.mv2 checkpoint
.venv/bin/python lab.py query work/demo-001/cap-whisper/whisper.mv2 country
.venv/bin/python lab.py info
.venv/bin/python lab.py network-check
```

`query` 以唯讀模式傳回命中內容及 URI；不自動修復或覆寫記憶檔。問答案例使用 `context_only=True`，輸出可引用的上下文，沒有生成式 LLM 回答。
語意與圖片案例的模型推論、向量索引、原始文字控制組、預期命中及重新開檔結果都留在 JSON。

## 場景

| 案例 | 可觀察行為 |
| --- | --- |
| UC-01 長期 agent | 新程序讀回 checkpoint，再追加 continuation |
| UC-02 企業知識庫 | scope 篩選、ACL enforce 允許、錯角色／跨租戶／缺 metadata 拒絕 |
| UC-03 離線系統 | 只複製 `.mv2` 到新目錄，以新程序查詢並驗證沒有必要 sidecar |
| UC-04 程式碼理解 | 從合成程式碼與設計文件找出函式及對應來源 |
| UC-05 客服 | 政策＋工單 context 與引用；未知問題無來源 |
| UC-06 工作流程 | pending／completed 的事件持久化與歷史查詢 |
| UC-07 業務 | 手工 memory cards、entity state 與 source frame；不冒充自動抽取 |
| UC-08 個人知識 | 繁中筆記、偏好更新與時間線；揭露斷詞限制 |
| UC-09 專業領域 | 三類合成文件的來源檢索；不產生醫療、法律或財務建議 |
| UC-10 審計 | 新舊 frame、as-of 檢索、session 持久化、真 FIND replay |
| UC-11 自訂應用 | metadata round-trip、soft delete 與完整性核對 |
| CAP-PDF | 真 PDF 檔經 SDK 擷取後可搜尋、可重開 |
| CAP-SEMANTIC | 本地 BGE 真向量；同義查詢的 lexical 控制組無命中，semantic 命中 |
| CAP-CLIP | 原生 MobileCLIP 對圖片／文字編碼；不透明圖片 ID 不含答案線索 |
| CAP-WHISPER | 原生 Whisper 真轉錄、入庫、搜尋及重開，另測錯誤退出 |

## 實際遇到的限制

1. **詞彙索引需要明確重建。** 此固定 SDK 的多筆寫入在探勘中出現 frame 遺漏／來源映射異常，seal 或 reopen 不保證修復。
   實驗使用官方 `doctor(rebuild_lex_index=True)` 作為新建資料的明示索引準備步驟，再用相同來源與內容 oracle 驗證。
   Deep verify 不能替代這些內容檢查；此實驗不表示上游原始寫入路徑已無缺陷。
2. **Whisper 是明示修正版。** Python wheel 沒有 Whisper feature；Rust helper 使用官方 crate 加兩處本地 cache 初始化補丁。
   原版忽略指定 cache 而嘗試下載的失敗保留；推論、音訊解碼與模型仍由 Memvid 原生實作。來源基準見 helper README。
3. **本地文字 embedding 使用 adapter。** wheel 的內建 BGE 路徑缺 fastembed feature。本案用真正 ONNX Runtime CPU 產生 384 維 BGE 向量，再交給 Memvid 真索引。
4. **CLIP 圖片不等於已封裝進記憶檔。** 使用 Memvid 原生 image/text encoder 與公開一般向量索引；PNG fixtures 另外保存，未宣稱支援未暴露的 Rust CLIP track 寫入。
5. **繁中與歷史查詢有邊界。** lexical tokenizer 不保證中文自然斷詞；同 URI 追加不是 SQL-style overwrite。驗收明確核對 frame／時間，沒有宣稱任意 snapshot restore。
6. **PDF 可能先印 native extraction 警告。** 此 wheel 的 extractous 路徑在本環境缺 AWT，之後由 native fallback 仍成功擷取；PASS 依實得文字與來源判定。
7. **Native `ask` 會擴大 context。** 探勘中未知詞仍可能帶回無關來源，unscoped ask 也可能只保留部分 lexical hits。
   客服案例先以真 `find` 選來源，再動態 scope；無命中則由明示的應用層 guard 回空。原始 ask 結果另存報告，未宣稱原生 ask 已修復。

模型授權、revision、URL 與 hash 在 [models.py](models.py) 及 [prepare_assets.py](native-whisper/prepare_assets.py)。
權重不隨 Git 分發。所有案例為合成內容或公開 fixtures；本專案未部署，也不把小型案例結果外推成效能、合規或 production 保證。

## 驗證入口

`make check` 執行真 SDK／CLI 的八項邊界 regression；`make full` 是場景與模型驗收。
repo 根目錄另執行 `python3 scripts/check_indexes.py` 與 `python3 .github/scripts/check_workflows.py`。
CI 入口：[memvid-lab-ci.yml](../../.github/workflows/memvid-lab-ci.yml)。任務與交付：[BOARD.md](docs/tasks/BOARD.md)。
