# OpenViking Context Lab

> **Portfolio doc tier: A — bounded experiment.** [Quickstart](docs/quickstart.md) · [SDD](SDD.md) · [Evidence](docs/evidence.md) · [Policy](../../docs/portfolio-doc-tiers.md)

以 OpenViking 作 AI 平台的共享 context 投影服務，先用兩份合成文件跑通「匯入 → 限定範圍檢索 → 校驗來源 → 有界 context bundle」。Python adapter 與離線測試可直接執行；真實 OpenViking/model/ACL 整合尚未驗收。

本項目是獨立試用接點，未修改 [agent-platform](../../platform/agent-platform/README.md) runtime 或既有 MVP gate。正式介接應由控制端 context adapter 經受控 broker 提供，不能把 server key 送進 agent sandbox。

```bash
cd labs/openviking-context
make check
make demo
```

`demo` 使用明確標示的 lexical fake，不是 OpenViking，也不代表 semantic retrieval 品質。Live server 安裝、key 設定、seed 與 query 見 [quickstart](docs/quickstart.md)。

## 責任與邊界

- Canonical 文件與人類決策留在原來源；OpenViking 內容、摘要與向量是版本化投影。
- 上游處理摘要、索引、session memory；本 lab 只提供 HTTP adapter、合成 fixture、來源/hash 驗證與完整 JSON byte budget。
- `seed` 只寫入本目錄固定合成 fixture，採 create-only＋回讀。遇既有不同內容即失敗，無覆寫、無自動 replay。
- Query 只接受 manifest 已核准且 hash 相符的 L2 文件；來源文字屬資料，不授予工具權限。
- 不自動安裝 agent hooks、不上傳聊天、私人 repository 或整個工作目錄；未啟用 session 自動記憶。

## 版本與來源

- 試用 server：`openviking==0.4.23`；release commit `df32bf6e50a40843438f9491a26069ca4bd08f1f`（2026-10-02）。
- 初始 main 研究快照：`9d9bc85e1f6a15afa7f23b0d7bf114a7c61cad14`；runtime 契約以 release 為準。
- 上游：[volcengine/OpenViking](https://github.com/volcengine/OpenViking)；[研究入口](docs/upstream-review.md)。
- 本目錄是新寫的獨立 HTTP consumer，沿用 repository MIT；未複製上游程式碼。OpenViking 主體為 AGPL-3.0，CLI/examples 有各自授權。安裝的上游不因此改為 MIT；產品化／修改再散布前另核對相關授權檔。

## 接手入口

先讀 [SDD](SDD.md) 的驗收表與 [evidence](docs/evidence.md) 的未驗證項；首個 live gate 是用核准的本機模型 provider，在獨立 workspace 完成 seed/query，記錄 server revision、model、latency、成本與回讀。跨使用者分享須先完成 ACL、撤銷及洩漏測試。
