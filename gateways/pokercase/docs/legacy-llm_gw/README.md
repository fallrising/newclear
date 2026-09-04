# llm_gw — 安全設計決策（已退役）

`llm_gw` 是一個 Rust LLM prompt gateway 原型，含 JWT、envelope encryption 與可插拔的 DB/message bus。
`pokercase`（thinrouter）是維護中的 gateway，已取代它。

這裡保留的是設計與決策紀錄，不是實作。原型的程式碼未經完整測試，不應直接沿用；
其中關於 JWT 驗證、envelope encryption 與 provider adapter 邊界的決策仍有參考價值。

**來源**：`fallrising/llm_gw` @ `0f2d282ee11b7ef638e10e7f7992e3f7902fee27`（2026-06-19）
**原 repository**：已 archive，完整歷史保留於該處。
