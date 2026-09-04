# SDD 文檔目錄

本目錄由 `SPEC.md` 管理。全局規則以 `SPEC.md` 為權威；節點規則以 `docs/nodes/*.md` 為權威。

## 入口

- [`graph.yaml`](graph.yaml)：machine-readable DAG。
- [`protocols/llm-execution-protocol.md`](protocols/llm-execution-protocol.md)：LLM 執行協議。
- [`protocols/document-change-control.md`](protocols/document-change-control.md)：文檔變更與 drift 管理。
- [`nodes/`](nodes/)：18 個可獨立派發的 SDD 節點。
- [`templates/`](templates/)：implementation plan、test plan、task、verification、ADR 模板。
- [`metrics/`](metrics/)：G2 方法指標。

## 權威順序

1. `SPEC.md`：產品、架構、安全、資料模型。
2. Node spec：該節點範圍、BDD、驗收。
3. Rust contract：command/DTO。
4. 衍生 task docs：只描述局部執行，不得新增需求。

當內容衝突時，不採「較新檔案優先」；必須回到擁有該事實的權威文檔修正。
