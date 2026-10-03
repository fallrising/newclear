# OpenMMO Lab

> **Portfolio doc tier: A (active)** — Runnable entry: [docs/quickstart.md](docs/quickstart.md).
> Policy: [portfolio doc tiers](../../docs/portfolio-doc-tiers.md).
> Investment notes: [PORTFOLIO.md](../../PORTFOLIO.md).

以固定版本的 [Julian-adv/OpenMMO](https://github.com/Julian-adv/OpenMMO) 建立個人 MMORPG 試驗入口：先跑通一個小世界，再做可獨立驗證的遊戲改動與上游貢獻。newclear 只保存本 lab 的工具、設計及驗收方法；上游源碼留在獨立 Git checkout，保留日後 fork／PR 的歷史。

**Status:** P0 啟動準備完成；Python 防呆測試與真實固定 checkout 的設定產生已驗證。Docker build、地形生成、Google 登入、雙人戰鬥／交易／重啟持久化尚未驗證。不是已可玩的遊戲發行版。

## 入口

- [Quickstart](docs/quickstart.md)：分批操作、環境檢查、停機與資料保留。
- [SDD](docs/SDD.md)：架構、邊界、驗收與後續階段。
- [驗收紀錄](docs/acceptance.md)：已執行與待執行項目。
- [版本鎖](upstream.lock.json)：上游 commit、資產 revision 與 lock checksum。
- [收藏索引](../../refs/OpenMMO/README.md)。

## 範圍

P0 僅啟動 terrain-init、server、client，HTTP 綁定本機 `127.0.0.1:18080`。無 agent service、LLM API 或公網入口。先以兩個真人角色驗證世界規則；新增遊戲系統前先完成基準驗收。

本 lab 自有程式依 newclear 根目錄 MIT；**外部 OpenMMO 是 PolyForm Noncommercial 1.0.0**，不因引用而改成 MIT。資產依各自來源條款。對上游貢獻前須自行閱讀 [LICENSE](https://github.com/Julian-adv/OpenMMO/blob/8ba09cf662bcc1b9d4ccebc0a7a1fba85cc47dc5/LICENSE) 與 [CLA](https://github.com/Julian-adv/OpenMMO/blob/8ba09cf662bcc1b9d4ccebc0a7a1fba85cc47dc5/CLA.md)；本 lab 不代簽 CLA。
