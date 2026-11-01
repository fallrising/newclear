# 2026-11-01 有界實驗紀錄

## 已實跑

官方 `microsoft/TokenEconomizer` commit `c53a4a6dcdebaeb9df6fcaa5c7026f0401cd8f23`；59 個 package 檔案 SHA-256 在 [lock](../../upstream.lock.json)。
[report.json](report.json) 是真 upstream hook／fold／state／CLI 的實際輸出，**輸入 session／tool catalog／usage 全是合成資料**。
不是在此文件重寫演算法，不用 mock 機制替代成功。

- **Micro-skills**：前 3 個 session 不注入，第 4 個注入命令修復 fact；相同 session 重送不增加計數；2 個反證 session 後退休。只跑 `envfacts`（無模型）。
- **Tool pruning**：5+5 prompts 才提案；額外負例：單次 10 prompts 不提案，第二次才可；5 次短 session 也能提案；NotebookEdit 要 30 prompts。曾使用與受保護工具保留。真 CLI apply/restore 只改 fixture repo，原規則／其他設定完整保留；restore 後不再自動提案。upstream 拒絕無效 JSON／跨 repo 設定 symlink。
- **Loop guard**：80-call 冷啟動不介入；5 次 8-call ended-green 後，重複失敗於 call 25 redirect、36 只通知一次；80-call 有進展的長 turn 無介入。失敗 turn 不訓練 envelope。使用明示 paused-judge state fixture，只驗證 hard-backstop 路徑；沒有假造模型成功判決。
- **計量與 CLI**：重複內容 blocks 只計一次 usage。虛構 11,700 raw tokens，以明示 toy weights 計為 3,625 fresh-input equivalents；額外虛構 side call 為 350，合計 3,975。**不是省了 8,075 tokens，也不是任何實際價格／成本**。

## 驗證

```sh
make -C labs/token-economizer-lab prepare
make -C labs/token-economizer-lab check
python3 -B labs/token-economizer-lab/run.py --out labs/token-economizer-lab/work/new-report.json
python3 scripts/check_indexes.py
python3 -m unittest discover -s scripts/tests -v
python3 .github/scripts/check_workflows.py --cache-dir /tmp/token-economizer-workflow-lint
ACTIONLINT_ARCHIVE=/tmp/token-economizer-workflow-lint/actionlint_1.7.12_linux_amd64.tar.gz python3 -m unittest discover -s .github/scripts/tests -v
```

本機 Linux／Python 3.12.14 執行：4 scenarios、36 scenario assertions、18 lab tests 通過；完整 report 多次重跑 byte-identical。fresh prepare clone 和既有 clone verify 均通過。
Repo gates：51 project contracts＋9 llms files／0 errors；20 repo validator tests 通過；43 workflows actionlint 1.7.12 通過；7 workflow-validator tests 通過。
CI 配置以 Python 3.12.14 fresh runner 再跑，結果以 PR checks 為準；本記錄尚不冒稱遠端 CI 已完成。

## 審查修復

獨立審查指出 package hashes 原先未阻止 checkout 根目錄的 `shlex.py` shadow stdlib。
已改為只將 hash 核對過的 package bytes 放入 fresh import root，child 不匯入原始 checkout 根。
加入真 `shlex.py` 負例：原 checkout 含該檔仍可 verify，但執行絕不載入它；同一 report 重跑通過。
最終獨立審查狀態記於 [review](review.md)。

## 不在證據內

沒有執行 upstream 全部 pytest suite、安裝任何 agent plugin、呼叫 provider、讀私人 session、測 live tool schema、測 model proposer／judge 的品質、量測實際 savings／task success。
上游含模型價格 snapshot；本例明確提供 toy weights，不將 snapshot 當現價。上游 paper 宣稱不是本 lab 的實驗結果。

Runtime 全程 credential-free environment、temporary HOME／state、network/subprocess denied，沒有任何被 guard 擋住但吞掉的嘗試（report 要求 blocked_attempts 為空）。負例測試另行證實 guard 拒絕讀寫外部檔案、symlink escape、network 與程序。這不是 OS/native-code 安全邊界。
