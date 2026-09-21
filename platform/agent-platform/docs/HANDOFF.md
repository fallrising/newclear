# 開發接續紀錄 — 2026-09-21

本次停止點：**PR #16 已依 operator 指示合併，M1 控制面切片已實作並通過本機驗收，下一步 M2。** M1 分支 `agent/agent-platform/m1-control-plane` 從 merged main `7bb80d0` 開始。完整操作與邊界見 [M1](M1.md)，硬體前置證據仍見 [KVM 驗收](KVM-VALIDATION.md)。

## M1 已完成

- FastAPI API、PostgreSQL SQL migrations、不可變 profile revision、task/run/command/event/queue/binding/reservation 與 fake operation ledger。
- 一次性 operator bootstrap、Argon2 password hash、可撤銷 session、exact Origin／CSRF、登入 rate limit；沒有預設密碼或公開註冊。
- 原子 create 與 route-scoped idempotency；partial unique index 保護單 task 的唯一 active run；明確 retry 帶 expected state version。
- 獨立 worker、SKIP LOCKED admission、四個 fake slots、lease/generation fence、expired ownership 保留 capacity 並標 interrupted。
- Fake adapters 的固定 operation ID、inspect／來源 event replay；backend cursor 與平台 seq 分開；結果保存後才 succeeded、observed fake cleanup 後才釋放 slot。
- React／TypeScript 工作台：登入、project／profile 建立、task 表單／列表／歷史、持久活動與結果；重試保留 key，事件為安全文字。
- 真實 PostgreSQL／HTTP 與獨立 worker process 驗收；45 個既有 tests + 21 個 M1 tests，Web 12 tests／typecheck／format／build 通過。結果見 [M1 evidence](evidence/m1-2026-09-21.json)。
- Python hash lock、npm lock、loopback development Compose、啟動文件與 root path-scoped CI。測試 database 容器／臨時 HTTP server 均已清理。

## 下一步

1. 依 [SDD](../SDD.md) M2 接入真正 SandboxProvider／AgentBackend，固定 M0 OCI template 與能力；不要把 fake operation ledger 當成已解決真實 allocation crash reconcile。
2. 完成 AT-02／AT-03／AT-10：兩個真實 VM、容量與 cleanup、100 events 的 browser reconnect／去重，以及 unsupported 能力的 UI／API gate；M1 尚未執行 browser E2E 或真實平台 adapter 任務。
3. API 路由在 `src/agent_platform/api.py`；資料與 queue 在 `store.py`／`worker.py`；schema 位於 `src/agent_platform/migrations/`；新 migration 擴充 fake-only profile constraint，不改寫已發布版本。
4. 工作台目前只允許 fake profile，清楚標示程式驗證未執行；尚未 clone repository、呼叫 provider、顯示真實 diff／artifact，沒有部署正式服務。
5. 真實 KVM 依 [KVM-HOST](KVM-HOST.md)／[KVM 驗收](KVM-VALIDATION.md) 重建專用配置。M0 的短期 registry 已移除，不能假設 `localhost:15000` 仍可拉取。
6. M3／M4 的 approval、完整 recovery、budget、artifact、export、backup／GC 與 production 尚未驗收。

## 必須保留的契約差異

- `template_digest` 是 promoted snapshot export digest，不是 OCI manifest digest；目前 probe 使用 configured pool／cold OCI claim。
- OpenHands `/interrupt` 只證實 paused；sandbox release ACK 與 claim-list 消失也不能單獨證實 VM 已停止。
- 每次 WebSocket 訂閱的首幀 full_state 快照不屬於持久化 history。
- SDK 0.1.12 wheel 的 sandbox.py 與研究時 source revision 不完全相同；exec timeout 不代表 guest 程序已終止。
- Session／sandbox token 從本機環境或 secret store 提供，不提交到 repository；沒有模型 provider key 需求。

設計見 [SDD](../SDD.md)，驗證命令與證據見 [M0](M0.md)，主機安裝與遠端執行見 [KVM-HOST](KVM-HOST.md)。
