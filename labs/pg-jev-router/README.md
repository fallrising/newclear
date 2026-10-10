# pg-jev Router Lab

> **Portfolio doc tier: A — bounded experiment.** [Quickstart](docs/quickstart.md) · [SDD](SDD.md) · [Evidence](docs/evidence.md) · [Policy](../../docs/portfolio-doc-tiers.md)

把用戶輸入轉成 `allow / block / review` 與 `small / coding / reasoning` 路由建議，驗證 pg-jev 能否作為 agent 平台的語意判斷接點。

**pg-jev 是 PostgreSQL 的 Jev API adapter，不是替代 Jev 的本地模型。** 預設呼叫 TypeSafe Jev；也能接相同 `POST /v1/systemone` 契約的 server。本 lab 固定真實擴充套件，搭配明確標示的 deterministic mock；沒有模型權重、付費 API、正式平台接線或模型 dispatch。

```bash
cd labs/pg-jev-router
make check        # Python stdlib：policy + HTTP contract
make demo         # 合成判斷結果，不需要 DB
make integration  # Docker：真 PostgreSQL/pg-jev -> loopback HTTP mock -> policy
```

## 對 agent 平台的判斷

| 用途 | 適配度與接法 |
| --- | --- |
| 意圖／輸入分類 | 可用 `jev_eval` 的 Choice；保留機率與 confidence，不只拿字串 |
| 對話攔截 | Noul 風險訊號 + 確定性政策；灰區／錯誤送 review，不能代替 ACL、工具審批或 sandbox |
| 模型分流 | Choice 分類後映射到 operator 核准的 immutable profile；lab 只回傳建議 |
| 已落庫對話的批次標記／離線回放 | pg-jev 的 SQL、批次預讀與 session cache 最有用之處 |
| 每則即時訊息的入口 | 能做，但多一層 DB I/O、占用 DB connection；本次匿名 record 不享有表格批次效益。應再比較控制端直接呼叫 decision API 的 p95／成本 |

[agent-platform](../../platform/agent-platform/README.md) 的 profile、model proxy、request budget 與授權流程保持原責任。未來接入點建議在建立 run／接納 message 前的控制端；執行中不能私自改 run 已固定的 profile。這是 lab 設計提議，未實作到平台。

## 已提供與限制

- 9 個中英文合成情境；未知文字回 review。Mock 以完整文字查表，不具有語意能力。
- 輸入 byte 限制、型別／機率／選項分布驗證、風險優先、低信心路由回退、錯誤遮蔽。
- 固定 pg-jev revision 的 disposable container；執行階段 `--network none`，無 port／host volume／secret。
- 真擴充套件驗證：完整案例、SQL literal、API 422／missing answer／invalid probability／timeout、批次、session cache、spend guard。
- 實測與未驗證範圍見 [evidence](docs/evidence.md)。合成案例通過不代表 Jev 中文準確率、攔截率、校準度或生產延遲。

來源：[`realZachi/pg-jev@8d9598d`](https://github.com/realZachi/pg-jev/tree/8d9598d87d5ff460998d91ec070226176024a841)，extension `0.2.1`；上游 PostgreSQL License，容器保留其 LICENSE。Lab 新寫程式沿用根目錄 MIT，上游源碼不 vendoring 入 repo。
