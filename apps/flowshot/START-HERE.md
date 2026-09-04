# START HERE — 第一個 LLM 執行回合

## 目標

只啟動 N00。不要提前實作 N01 或產品功能。

## 必讀

- `SPEC.md`
- `docs/graph.yaml`
- `docs/nodes/N00-foundation-ci-contracts.md`
- `docs/protocols/llm-execution-protocol.md`
- `docs/protocols/document-change-control.md`

## 第一個輸出

在任何 production code 前建立：

```text
docs/tasks/N00/00-implementation-plan.md
docs/tasks/N00/01-test-plan.md
docs/tasks/N00/T01-scaffold-rust-workspace.md
...
contracts/locks/N00.json
```

使用 `docs/templates/`，不得自行省略 front matter。

## N00 前置事實 Gate

執行者必須先確認並記錄：

- Rust/Node/Tauri toolchain 實際可用。
- repository 是乾淨新 repo。
- `SPEC.md` SHA-256 與 N00 front matter 一致。
- N00 allowed paths 沒有其他 writer。
- 能在目標 macOS 環境啟動最小 Tauri 視窗。

## 禁止

- 不建立 SQLite product schema。
- 不寫 Markdown renderer。
- 不搬入 legacy 全部 command。
- 不手寫 generated TypeScript。
- 不把聊天中的額外需求帶入 scope。
