# Agent Workforce

> **Portfolio doc tier: A（M1 核心與有界 M2 原生切片）** — 跨產品整合仍依里程碑驗證。
> [Quickstart](docs/quickstart.md) · [文件政策](../../docs/portfolio-doc-tiers.md) · [Portfolio](../../PORTFOLIO.md)

Agent Workforce 的 M1 是可在本機執行的 Python 標準庫控制核心：可信 registry／grant admission、SQLite inbox/outbox 與命令去重、fake dispatch、有限預算、資源保留及普通重啟恢復。範圍與測試對應見 [M1 契約](docs/m1.md) 和 [驗收](docs/verification.md)。

**狀態：M1 離線核心與有界 M2 adapter 切片已實作。** [M2 契約](docs/m2.md) 分列 Codex writer／Claude reviewer 的事件、程序、會話與逐 route 證據。明確選用的 subreaper port 已對兩條新原生呼叫取得本機後代停止證明；原 polling operations 保持 unknown。遠端 effects、完整 native resume／auth 與 Codex 串流工具觀測仍有缺口，不能宣稱完整 M2 通過。Daemon、SaaS/API、完整 artifact/review/publisher、ContextPack、backup/restore 與長時間運作仍未交付。用來開發程式的模型工具不構成本產品的原生 adapter 驗收。

從本目錄執行：

```sh
PYTHONPATH=src python3 -m unittest discover -s tests -v
PYTHONPATH=src python3 -m agent_workforce demo --db var/demo.sqlite
```

需要 Python 3.11 以上及 Unix 的 flock；沒有第三方執行期套件。Demo 使用合成 operator、固定 fake clock 和 FakeBackend，產生 `awaiting_review` 及可觀察的命令／operation／資源計數。重跑同一資料庫會返回原命令；外部 Done 仍由工作系統決定。

## 從哪裡讀

| 文件 | 內容 |
| --- | --- |
| [Quickstart](docs/quickstart.md) | 本機測試、demo 與前置條件 |
| [M1 契約](docs/m1.md) | API、交易邊界、恢復行為及延期項 |
| [M2 契約](docs/m2.md) | 原生 profile、事件／程序證據、保守恢復及尚未通過的 gate |
| [SDD](SDD.md) | 完整產品的身分、route、會話與里程碑設計 |
| [能力表](docs/provider-capabilities.md) | 產品能力與各自的接入／驗收條件 |
| [第一場景](docs/first-scenario.md) | 未來兩個原生 agent 的工程協作驗收 |
| [驗收與證據](docs/verification.md) | DOC、FAKE、NATIVE、API、LIVE、SOAK 分層 |

## 系統邊界

Workforce 擁有本層的 worker／account／resource 綁定、准入、持久訊息及 execution coordination。目標、AC、審查與 Done 保留在外部工作系統。可信 caller 是本機呼叫端提供的邊界輸入；M1 沒有 production authentication 或 authorization service。

[Kith](../../products/kith/README.md) 的聊天及 replay 規則、[Agent Platform](../agent-platform/README.md) 的執行 authority、[HAI Taskboard](../../products/hai-taskboard/README.md) 的完成 authority 保持各自責任。本切片沒有改動或接通這些產品。
