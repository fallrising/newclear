# Delivery evidence

日期：2026-10-04。這份文件只記本 lab 的驗證，不聲稱上游已通過正式平台驗收。

| Check | Result |
| --- | --- |
| `make check` | PASS：19 個 stdlib unittest＋offline demo；不需 credentials/network |
| `python3 context_lab.py demo --query 'backup retention'` | PASS：核對 fixture SHA/revision，返回 backup evidence |
| `demo --max-bytes 512` | PASS：輸出完整 metadata、略去放不下的全文，不截斷 provenance |
| HTTP request/response contracts | PASS：mock opener 驗證 route/body/header/error/redirect；沒有真實 TCP/server |
| Upstream source/release | v0.4.23 = `df32bf6e50a40843438f9491a26069ca4bd08f1f`；source review 見 upstream-review |
| Live server install/start/doctor/seed/query | SKIPPED：未選定 provider／憑證；不安裝或啟動 paid/live service |
| Real ACL、memory extraction、restart/restore、model quality/cost | NOT RUN；不得外推成 production-ready |

測試涵蓋 unknown/out-of-scope URI、revoked/candidate、hash mismatch、L0 不能冒充 L2、重複 hit、空命中、完整 UTF-8 byte budget、create-only 冪等與未知寫入不 replay。它們驗證 client 行為，server 的身份／ACL Enforcement 尚待獨立正負向驗收。

Live gate 後應追加實際環境與結果，不改寫此處 skipped 為歷史成功；量測欄位與操作入口見 [quickstart](quickstart.md)。
