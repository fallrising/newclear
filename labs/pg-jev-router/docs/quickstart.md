# 可重現試跑

## 1. 無 DB 的 policy demo

需求：Python 3.11+、make、bash；不需 pip／key。

```bash
cd labs/pg-jev-router
make check
make demo
python3 demo.py --text '未收錄的任意輸入'
```

最後一行回 review，因 mock 只識別固定合成文字。Demo 的 `extension:false` 表示完全沒有跑 PostgreSQL。可修改 `fixtures.py` 擴充合成 case，再在 tests 加入預期；這只測接線與政策。

## 2. 真 PostgreSQL 與 pg-jev

需求：Docker engine、可在 image build 時存取 Docker Hub、Debian package mirror、GitHub。

```bash
make integration
```

單一 disposable container 安裝上游固定 revision／0.2.1，啟动 PostgreSQL 16 和 loopback fixture，執行全部測試，再印九案 JSON（`extension:true`）。容器執行階段無外部網路、無 host port、無 host mount；測試資料在 tmpfs，`--rm` 清理容器。Image 會留在本機，可用 `docker image rm pg-jev-router-lab:8d9598d` 清除。

成功判準：unit suite 與 integration suite 都為 OK；`CACHE` 顯示第二次不增加 request，`BATCH` 顯示九列使用少於九次請求；九案 action/route 符合 fixture。CI 使用同一命令。

本次編輯環境無 Docker，這條本機命令為 skipped；hosted CI 已完整通過，確切 run 與結果見 [evidence](evidence.md)。不要把 `make check` 說成擴充套件已跑過。

## 3. SQL 與程式入口

- `sql/bootstrap.sql`：isolated lab DB 安裝 extension 與非 superuser client role；不可套到 production DB。
- `pg_adapter.py`：固定 loopback API、投影 text、bounded psql、兩類問題。
- `mock_api.py`：Jev wire contract fixture，拒絕含非 text 欄位或 Authorization 的请求。
- `policy.py`：純 policy，可單獨替換 evaluator 測試。
- `tests/integration_pg.py`：直接可閱讀的 SQL cache／batch／spend guard 實驗。

這一版沒有 live API 開關，不讀 `TYPESAFE_API_KEY`。要測模型品質，先依 SDD 定義資料、核准 provider、成本與操作範圍，再建立獨立 evaluator；不要改 mock 標籤來宣稱實測。
