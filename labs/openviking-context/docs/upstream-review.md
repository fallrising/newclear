# OpenViking 來源研究

查核日期：2026-10-04（Asia/Singapore）。先讀 main `9d9bc85e1f6a15afa7f23b0d7bf114a7c61cad14`，再切至 v0.4.23 `df32bf6e50a40843438f9491a26069ca4bd08f1f` 校對試用 API。以下是架構／核心路徑研究，不宣稱逐行審計整個 repository。

## 結論

值得試用的是可瀏覽的 context filesystem、directory sidecars、scoped retrieval、session → memory 以及跨 client HTTP/MCP 介面。平台需自行管理 canonical ownership、promotion、授權映射、召回品質與撤銷。上游的多租戶／ACL 不能只靠目錄名稱理解。

| 查核材料（固定版） | 發現及本項目採用方式 |
| --- | --- |
| [README](https://github.com/volcengine/OpenViking/blob/df32bf6e50a40843438f9491a26069ca4bd08f1f/README.md)、[Team](https://github.com/volcengine/OpenViking/blob/df32bf6e50a40843438f9491a26069ca4bd08f1f/docs/en/about/01-about-us.md) | Volcengine Viking 團隊維護的 context database；memory/resource/skill 共用 URI；不把 README benchmark 外推成本平台收益 |
| [Architecture](https://github.com/volcengine/OpenViking/blob/df32bf6e50a40843438f9491a26069ca4bd08f1f/docs/en/concepts/01-architecture.md)、[Storage](https://github.com/volcengine/OpenViking/blob/df32bf6e50a40843438f9491a26069ca4bd08f1f/docs/en/concepts/05-storage.md) | HTTP service → services → VikingFS/RAGFS＋vectors；向量索引也有可讀文字，不是只要保護原文件 |
| [Context types](https://github.com/volcengine/OpenViking/blob/df32bf6e50a40843438f9491a26069ca4bd08f1f/docs/en/concepts/02-context-types.md)、[Layers](https://github.com/volcengine/OpenViking/blob/df32bf6e50a40843438f9491a26069ca4bd08f1f/docs/en/concepts/03-context-layers.md) | L0/L1 是目錄 sidecars，預設 256/4000 **characters**；可缺其中之一；L2 可能是 parsed body，不保證原二進制保存；source metadata 有 whitelist，平台 provenance 放外部 manifest |
| [Retrieval](https://github.com/volcengine/OpenViking/blob/df32bf6e50a40843438f9491a26069ca4bd08f1f/docs/en/concepts/07-retrieval.md)、[retriever code](https://github.com/volcengine/OpenViking/blob/df32bf6e50a40843438f9491a26069ca4bd08f1f/openviking/retrieve/hierarchical_retriever.py) | v0.4.23 改為一次 global recall/query＋可選 rerank；scope 仍受 URI/permission/filter 限制。class 名稱保留 HierarchicalRetriever，但不再逐層遞迴 |
| [Session](https://github.com/volcengine/OpenViking/blob/df32bf6e50a40843438f9491a26069ca4bd08f1f/docs/en/concepts/08-session.md)、[Transactions](https://github.com/volcengine/OpenViking/blob/df32bf6e50a40843438f9491a26069ca4bd08f1f/docs/en/concepts/09-transaction.md) | commit 先 archive 再 async extraction，需觀察 task；path lock＋queue 不是跨 storage ACID。memory update 能改／刪舊記憶；P0 不啟用自動記憶 |
| [Multi-tenant](https://github.com/volcengine/OpenViking/blob/df32bf6e50a40843438f9491a26069ca4bd08f1f/docs/en/concepts/11-multi-tenant.md)、[ACL](https://github.com/volcengine/OpenViking/blob/df32bf6e50a40843438f9491a26069ca4bd08f1f/docs/en/concepts/15-acl.md) | account 外界、user 私有；resources 預設 account 共享；ACL 關閉預設、root wildcard manage、restricted inheritance、eventual revocation 都必須納入測試 |
| [Authentication](https://github.com/volcengine/OpenViking/blob/df32bf6e50a40843438f9491a26069ca4bd08f1f/docs/en/guides/04-authentication.md)、[Deployment](https://github.com/volcengine/OpenViking/blob/df32bf6e50a40843438f9491a26069ca4bd08f1f/docs/en/guides/03-deployment.md) | 分開 root 管理 key 與 user data key；dev mode 限 loopback；server-only 需關 bot；本次 runbook 用單程序＋專用 workspace |
| [Content API](https://github.com/volcengine/OpenViking/blob/df32bf6e50a40843438f9491a26069ca4bd08f1f/docs/en/api/12-content.md)、[content router](https://github.com/volcengine/OpenViking/blob/df32bf6e50a40843438f9491a26069ca4bd08f1f/openviking/server/routers/content.py)、[search router](https://github.com/volcengine/OpenViking/blob/df32bf6e50a40843438f9491a26069ca4bd08f1f/openviking/server/routers/search.py) | create-only 可自建 parent；read result 是字串；find 可指定 level=2。write wait=true 不保證 parent sidecar 完整刷新，adapter 不把成功寫入等同召回成功 |
| [Snapshot](https://github.com/volcengine/OpenViking/blob/df32bf6e50a40843438f9491a26069ca4bd08f1f/docs/en/guides/15-snapshot.md)、[OVPack](https://github.com/volcengine/OpenViking/blob/df32bf6e50a40843438f9491a26069ca4bd08f1f/docs/en/guides/09-ovpack.md) | snapshot 不版本化 ACL/index；OVPack 是明文且不含 registry，hash 不是信任簽章；不能當完整備份 |
| [MCP clients](https://github.com/volcengine/OpenViking/blob/df32bf6e50a40843438f9491a26069ca4bd08f1f/docs/en/agent-integrations/06-mcp-clients.md)、[Roadmap](https://github.com/volcengine/OpenViking/blob/df32bf6e50a40843438f9491a26069ca4bd08f1f/docs/en/about/03-roadmap.md) | 已有 /mcp 及各 client adapter；後續方向為 distributed storage、更多 agent adapter，沒有交付時間承諾；本次不安裝全域 hooks |
| [License](https://github.com/volcengine/OpenViking/blob/df32bf6e50a40843438f9491a26069ca4bd08f1f/LICENSE)、[pyproject](https://github.com/volcengine/OpenViking/blob/df32bf6e50a40843438f9491a26069ca4bd08f1f/pyproject.toml)、[Release](https://github.com/volcengine/OpenViking/releases/tag/v0.4.23) | 主體 AGPL-3.0、Python≥3.10、仍標 Alpha；版本變動涉及 ranking、設定相容性，需要固定 corpus 重驗 |

## 此次沒有證明的事

沒有執行 upstream 全套 tests、真實 VLM/embedding、吞吐量/品質 benchmark、多租戶 ACL 壓測、backup/restore 或 agent-platform broker 接線。上表是來源能力與設計採用，不是 live 驗收紀錄；本次實際結果見 [evidence](evidence.md)。
