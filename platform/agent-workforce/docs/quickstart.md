# Quickstart：M1 離線核心

M1 提供本機 Python API 和合成 CLI demo。需要 Python 3.11 以上、Unix 的 fcntl/flock，以及可寫的 SQLite 檔案位置；沒有 package install、帳號登入或網路前置。

## 測試與觀察

在 `platform/agent-workforce` 目錄執行：

```sh
PYTHONPATH=src python3 -m unittest discover -s tests -v
PYTHONPATH=src python3 -m agent_workforce demo --db var/demo.sqlite
PYTHONPATH=src python3 -m agent_workforce demo --db var/demo.sqlite
```

Demo 第一輪會先提交命令與 attempt intent，再呼叫 FakeBackend，記錄合成完成結果和完整停止／effects 證據。JSON 輸出包括 `command_id`、`operation_id`、`state`、`commands`、`backend_starts`、`held_reservations`、`usage` 和 `external_done`。

同一 fixture／資料庫的第二輪保留相同 command／operation，`backend_starts` 是本輪零次。結果停在 `awaiting_review`；`external_done` 為 false，未知 provider 用量／費用為 null。這個固定 clock 的 demo 不呼叫模型或真實工具，也不驗證任何原生 session。

資料庫保留訊息、意圖、資源與 audit。一次只開一個 controller；關閉 Store 後再開啟會建立新的 epoch。若要測其他 fixture，選新的明確資料庫位置，避免把不同輸入當作同一 job/step。

交付的測試在 CPython 3.11.16 實際執行；涵蓋范围與延期項見 [M1 契約](m1.md) 及 [驗收](verification.md)。在共用 agent workspace 中執行時，依所在環境的 launcher 規則把測試暫存、demo DB 與證據放在它分配的目錄；不要把這些狀態當成可自動清理的 cache。

## 下一道門檻

M2 的每條原生 route 仍要有實際 entitlement、版本、精確 model/profile、工具／拒絕／停止／session 證據。Native、API、LIVE、SOAK 保持 NotRun；完整 artifact/review/publisher/context/backup 也需獨立實作與驗收。讀文件或跑 fake 不會建立帳號、登入、調用付費模型或部署服務。
