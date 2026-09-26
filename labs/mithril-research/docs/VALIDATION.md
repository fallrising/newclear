# M0 驗證記錄

日期：2026-09-27。範圍：原創研究文件、來源 lock、loopback 設定與 root 索引；不是 upstream runtime 驗收。

## LOCAL-RUN

工作環境：Linux x86_64，Python 3.13.5。檢查本研究產物的 UTF-8／末尾換行／無 trailing whitespace、Markdown fence 配對、相對文件連結（本地研究文件及已讀取的倉庫目標）、JSON 必要欄位與固定 commit/blob 格式、loopback 設定及 MR 任務計數。研究文件內的上游連結都固定 commit。

Root PORTFOLIO 在修改前重建並核對 Git blob SHA，確認與已讀來源 `af673061f29dd29111c7540d342f3356b14bcbb9` 相同；只新增本項目 A-tier 記錄與有界研究 owner override。Root README 只新增本項目索引行。沒有修改既有 component、.team program ledger 或 workflow。

上述 static checks 的範圍不包含全倉庫 link crawling、Markdown renderer、external link availability、Mithril 設定 parser 或 GitHub CI。版本／路徑核對與程式碼閱讀不是編譯或整合測試。

## SKIPPED / NO RESULT

| 項目 | 結果與原因 |
| --- | --- |
| `git clone` in shell | FAILED：無法解析 github.com；未得到 upstream checkout |
| Rust build/test/clippy/fmt | SKIPPED：cargo、rustc 不存在 |
| Redis Cluster／Docker fixture | SKIPPED：Docker、redis-server、redis-cli 不存在 |
| 上游整合 suite | NO RESULT：沒有執行；其 98-test 說法僅是上游聲明 |
| RESP3／migration／cache／ACL／failover | NO RESULT：只有來源研究與待測契約 |
| benchmark／容量／soak | NO RESULT：沒有 Mithril performance 數值 |
| production／真實 VPS | NOT ATTEMPTED：不在授權範圍 |

## 交付與後續證據

本次沒有新增可執行 harness，所以沒有新增 CI workflow。遠端 PR 是否有 checks、是否已合併，必須讀 GitHub 當時狀態；本文件不預先寫成 CI passed 或 merged。

M1 起每筆 runtime evidence 必填：run ID、研究 commit、upstream commit、image digests、binary SHA-256、toolchain、精確命令／設定 hash、環境、開始／結束時間、exit status、去識別 log、判斷與限制。缺任一關鍵身分不得拿來更新採用判斷。
