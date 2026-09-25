# ERU-012 離線 desired-state 前置

日期：2026-09-25。ERU-012 仍進行中，固定任務總數不變。依 owner 指示先完成離線開發，再統一做 VPS E2E；此文件記錄的是本機實作，沒有建立／更新／移除任何 VPS workload。

## 本機交付

`scripts/app_desired.py` 定義 v1 stateless HTTP app spec 與唯讀差異規劃：

- 要求版本化 JSON、sha256 固定 image、指定 worker、明確 replicas／CPU／memory／storage、`eru` 私網，以及可核對的 HTTP path／status／body；未知欄位一律拒絕，因此不接受環境變數、secret 或 volume。
- 將正規化 spec 算成穩定 SHA256，並由 logical name + spec hash 產生固定 Eru appname；在相同 revision 查到完整且身分一致的 workloads 時判為 no-op。
- 遇到同 app 未知 owner、錯誤 digest、部分／多出的 replicas、錯誤 node 或 release name 被外部 workload 佔用時封鎖，避免重送 create 造成重複副本。較舊但有明確 owner／digest 的 revision 只列出保留，不自動移除。
- 產生可供審閱的 Eru spec 與 deploy argv，但計畫永遠 `executable: false`。本切片尚無遠端 plan／journal／executor；即使 spec 可解析，也不代表能部署。

上游 CLI 的 workload deploy／JSON 查詢與 spec 語法以固定版本來源為基礎，見 [來源基線](SOURCES.md)。

## 尚未完成

本 planner 不接觸 SSH 或 cluster，亦未驗證容量餘額、etcd/core 健康、workload runtime、registry 拉取、HTTP readiness、失去 deploy 回覆後的遠端對帳，或 exact-ID cleanup。仍須實作並本機模擬 plan/hash/journal 執行器；之後在 VPS E2E 驗證真實 API/job，並證明相同 spec 不累加副本、create 回覆遺失可先對帳、revision 替換可先就緒再精確清理舊版。資料持久性與 volume 不屬 v1 stateless contract。

## 本機驗證

新增 15 個單元測試，覆蓋規格拒絕條件、digest／appname 穩定性、YAML escaping、空叢集 create plan、相同 revision no-op、部分／重複副本 fail-closed、未知 ownership、舊 revision 保留、目標節點不可用與 snapshot hash 綁定。完整套件共 226 tests 通過（本輪新增 15）；無 VPS E2E。
