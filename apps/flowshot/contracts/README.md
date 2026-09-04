# Contract Pipeline

## 權威

- Rust DTO 與 command descriptor：`crates/core/src/contracts/`。
- Tauri implementation：`src-tauri/src/commands/`，直接使用相同 DTO。
- TypeScript：`src/generated/contracts/`，由 `cargo xtask contracts` 生成。
- Freeze metadata：`contracts/locks/{NODE}.json`。

## Lock 格式

```json
{
  "schema_version": 1,
  "node_id": "N05",
  "status": "planned|frozen",
  "source_files": [
    "crates/core/src/contracts/N05.rs"
  ],
  "source_sha256": "...",
  "commands": [
    "build_anchor"
  ],
  "generator_version": "...",
  "frozen_at": "RFC3339"
}
```

`planned` 只用於尚未存在 Rust authority/generator 的 bootstrap 階段；
`source_sha256`、`generator_version` 與 `frozen_at` 可為 null。任何
implementation 或 downstream node 禁止把 planned lock 當成凍結 contract。
`frozen` 時三個欄位都必須有值，且 drift check 必須通過。

## 規則

1. TypeScript 生成物禁止手改。
2. Command request 是單一 object。
3. Response 為 typed DTO。
4. Error 為 `AppErrorDto`。
5. 已凍結 dependency 的 breaking change 需要 ADR。
6. `make check-contracts` 必須在 CI 阻斷 drift。
7. Planned lock 必須在第一個使用該 contract 的 implementation task 前轉為
   frozen。
