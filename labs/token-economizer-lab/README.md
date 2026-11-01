# TokenEconomizer lab

**不是只讀設計：這裡真的跑 Microsoft TokenEconomizer 的 package、session hooks 與 CLI。**
先看 [SUCCESS](SUCCESS.md) 的驗收範圍與缺口；[SDD](SDD.md) 是本輪有界問題。

## 跑一次

需要 Python 3.10+、Git、Make；Linux/macOS。無 pip/npm 依賴。

```sh
cd labs/token-economizer-lab
make prepare  # 下載官方 source，固定 commit + 59 個 package 檔 SHA-256
make run      # 真上游執行；合成 traces；stdout JSON 結果
make check    # 18 個來源、安全邊界、端到端／可重現性 tests
```

已有 clone 可指定 `make run SOURCE=/path/to/TokenEconomizer`，但 pin／內容不一致會拒絕。
`make prepare` 不會重設或覆寫既有來源；若已污染，改用新的 `SOURCE` 目錄重新準備。
保存新報告：`python3 -B run.py --out work/run-01.json`；已有檔案不覆寫。
runtime 約數秒，下載需網路；完成 prepare 後 runtime 不需網路。

## 實際試什麼

| 實驗 | 真上游入口與觀察 | 不是什麼 |
| --- | --- | --- |
| micro-skills | `SessionEnd → fold → EnvFactsDistiller → SessionStart`；四個合成 session 後注入 `pytest` 改用 `python -m pytest`，兩個反證後退休，session 不重算 | 沒有跑模型 proposer，不是模型「學會」後的 task success 評測 |
| tool pruning | 真 prompt/session evidence：5+5 prompts 後提案；protected／ever-used 工具保留；sandbox 內真 CLI apply/restore 且保留使用者既有規則 | 沒安裝 Claude／沒有實測下一個真 API request 的工具 schema 大小 |
| loop guard | 真 hooks＋五次 ended-green envelope；冷啟動不介入；paused-judge hard backstop 在 call 25 redirect、36 notice；80-call productive turn 不介入 | pause 是明示合成 fixture，不是真登入失敗；沒有驗證 LLM judge 品質，永不自動停 agent |
| accounting／CLI | 真 usage reader 去重、cache-aware 計算、`config`／`status`／`microskills`／`toolprune` | 11,700 raw tokens → 3,625 weighted input equivalents 是同一筆虛構 usage 的不同計量，不是節省 69%！ |

[已保存的機器報告](docs/evidence/report.json) 與 [實驗紀錄／限制](docs/evidence/README.md)。

## 三種「省」的邏輯

1. **避免重學**：把跨 session 確認的少量 repo facts 放進下一次 context，省重複探索與失敗重試。
2. **少載無用工具定義**：把從未用過且證據充足的工具／capability／MCP server 從後續 session 載入設定移除，降低每次 request 的工具描述開銷。不是縮寫 prompt。
3. **少走失敗循環**：廉價 trace gate → model judge（本 lab 不啟動）或遠超正常長度的 hard backstop → redirect；仍卡住只通知人，不幫你停止。

這些都可能有副作用及額外成本。micro-skills 預設 off，`envfacts` 不叫模型；`on` 才加 proposer。一般 loopguard judge 會叫使用者的 agent／模型。paper 的 savings 不能當這個 lab 的 savings。

## 隔離、資料與限制

- `prepare` 只 clone/check out pinned 官方來源，不跑 setup 或 upstream scripts、不安裝 plugin。執行前只將 manifest 核對過的 package bytes 複製到 fresh import root，不把 checkout 根目錄放入 Python import path。下載位置 `.upstream/` 忽略提交；保留第三方 LICENSE。
- 每次 runtime 用新 temporary HOME／state／fixture repo，完成即清除。父程序不讀真 session 或 auth 檔，child 不繼承 provider keys、host config、PATH；沒有 agent CLI 子程序。
- Python audit guard 拒絕 network／subprocess，讀取限 lab、upstream、Python runtime、sandbox，寫入限 sandbox。這是**已核對可信 Python 的護欄，不是敵意 native code 的 OS sandbox**。
- 不改真 `.claude/settings.local.json`、`.codex/config.toml`、global plugin 或 repository trust。
- 只保留相對／`<sandbox>` 路徑和合成資料。`report.json` 不含帳號、主機、憑證或實際私人 session。
- Windows 尚未驗證；目前 launcher 的 hook 禁用路徑及 CI 針對 POSIX。
- 不測 live host、paid proposer／judge、實際 billed tokens、quality A/B、多 agent 相容性；無 usable tag／部署。

## 如果之後要測真正省多少

先批准 host／model、公開任務集合與成本上限，再在**另一個隔離工作目錄**安裝本 pin 的官方 plugin。不要對日常 repo 自動安裝。
baseline 和 optimized 要分開 state，固定模型／任務順序／起點；要保留冷啟動與暖啟動結果，將 input/cache-read/cache-write/output 與 proposer/judge 全計入；同時記錄 task success、wall time 及人工中斷。不可只比較 raw tokens，亦不可把這裡的合成報告拿來回答 A/B。

上游：[固定 README](https://github.com/microsoft/TokenEconomizer/blob/c53a4a6dcdebaeb9df6fcaa5c7026f0401cd8f23/README.md)、[plugin 說明](https://github.com/microsoft/TokenEconomizer/blob/c53a4a6dcdebaeb9df6fcaa5c7026f0401cd8f23/plugin/README.md)。
