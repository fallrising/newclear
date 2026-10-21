# Wotar 修復驗證（發布待完成）

RESULT: PENDING
Project: systems/wotar
Tag: none
Source: 33c9663e7590020fb0147c30e81e7a8db375db2b
Startup: 新 CA/client/server/keyring、doctor 與真 EMQX 5.8.3 mTLS listener — passed
Core: 真 TLS E2EE、篡改/topic/replay、rotation、durable recovery、ACL negatives、另一 broker 合成 smoke — passed
Checks: lint/typecheck、183 native tests、86.49% coverage（原86%）、15 integration、1 public smoke — passed

必要 PR CI、合併及遠端核對仍待完成，未建立 usable tag。
環境 Python3.12.3/OpenSSL3.0.13、既有 dev dependencies；沒有新增 runtime dependency。
EMQX pinned digest 與 exact argv/exit/duration 見 [commands](../evidence/wotar-repair/readiness-fixed/commands.json)。
隔離暫存 source + 新憑證，唯一容器/bridge，僅發布127.0.0.1:8883。
[isolation](../evidence/wotar-repair/readiness-fixed/isolation.json)：來源未改、cleanup_errors=[]。
未寫既有 credentials/config/user data；public broker 僅 opt-in 隨機 namespace 合成密文。

| AC | 實際證據 |
| --- | --- |
| AC-01 | [integration](../evidence/wotar-repair/readiness-fixed/integration.log)：15 passed，publisher/subscriber roundtrip、ciphertext、durable outbox/inbox restart |
| AC-02 | [native](../evidence/wotar-repair/final-native/native.log)：tamper matrix、topic/replay；真 integration duplicate 不交付 |
| AC-03 | 同份 native：rotation/history/revoked/retired policy、keyring/provider/lifecycle |
| AC-04 | 真 integration TLS-only/hostname/ACL negatives；[public smoke](../evidence/wotar-repair/isolated/public-smoke.log)：1 passed，另一 broker profile |
| AC-05 | final-native：lint/format/mypy/doctor、183 tests、86.49%；原 test_mqtt_reconnect 三項憑證 skips 全執行。另有 readiness socket2 cases、cleanup3 cases |

執行(repo root)：`python3 systems/wotar/secure-mqtt-e2ee/scripts/verify_isolated.py --output <new-dir> --integration`。
整合後增加 cleanup regressions，再以省略 integration 的同命令跑最終 native；public smoke 原始 run 加 public-smoke。
[source continuity](../evidence/wotar-repair/source-continuity.json)：各 fixture runtime src 全部相同；
整合後僅增加 runner regression/README，不影響 public smoke 或 runtime。

失敗保留：

- [lint-red](../evidence/wotar-repair/lint-red.log)：I001；僅移動 import。
- [isolated integration](../evidence/wotar-repair/isolated/integration.log)：15 skipped；Docker internal bridge 未發布 host port，整體失敗。改 dedicated bridge/loopback，未削弱測試。
- [isolated-fixed integration](../evidence/wotar-repair/isolated-fixed/integration.log)：5 failed/10 passed；TCP proxy 接受早於 EMQX TLS。改真 mTLS readiness，實際 TCP/TLS socket regression 證明差異。
- 獨立審查 REWORK：start failure/rm failure/logs timeout 會漏清理或回傳成功。cidfile ownership、獨立 cleanup attempts/error gate 修復，3 regression 及複審通過。

[任務報告](../../../systems/wotar/tasks/442-required-gates/report.md)記錄審查與待完成交付 gate。
不外推 production 部署、forward secrecy、任意 production ACL 或 owner 驗收。
