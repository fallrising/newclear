---
project: systems/wotar
purpose: 以自管金鑰在 MQTT 上提供端到端加密的發布與訂閱
kind: tool
mainline: incomplete
usable_tag: none
reviewed: 2026-10-21
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# Wotar 成功契約

## 主線與範圍

[progress](secure-mqtt-e2ee/docs/progress.md)記錄原始 phase 0–10 完成；主線是 strict TLS 上的 AES-GCM-SIV/Ed25519 envelope、topic binding、replay 防護與 durable inbox/outbox。
正式 key 模型為 operator-owned FileKeyringProvider；同一 crypto layer 可更換 broker。

端點被入侵會暴露 keyring；分發 DEK 沒有 forward secrecy。
Cloud KMS、任意 payload schema 與 production broker ACL 審查不屬已完成本機功能；維持 dormant 投入狀態。

本契約核對的是上述來源版本中的文件與程式。
原功能歷史完成不代表目前必要檢查已通過；未延伸為部署或生產保證。

## 驗收條件

下表 `historical` 是既有報告的結果，沒有在 2026-10-21 重跑。
`pending` 保留缺少證據或尚未實作的條件；程式存在不等於通過。

| AC ID | Given / When / Then | 狀態 | 證據或缺少原因 |
| --- | --- | --- | --- |
| AC-01 | Given 信任的 publisher 與 keyring，When 加密發布並由合法 subscriber 收取，Then broker 只見密文且 endpoint 驗簽解密 | historical | [progress](secure-mqtt-e2ee/docs/progress.md)：local EMQX TLS/E2E integration |
| AC-02 | Given 篡改 envelope、錯 topic 或 replay，When subscriber 驗證，Then 不交付未授權 plaintext 且重複訊息被去重 | historical | [progress](secure-mqtt-e2ee/docs/progress.md)：40-case tamper matrix 與 replay tests |
| AC-03 | Given 舊 DEK 與新 active key，When rotation 並讀取歷史 ciphertext，Then 按 key 狀態解密且 revoked/retired 邊界遵守政策 | historical | [progress](secure-mqtt-e2ee/docs/progress.md)、[key lifecycle](secure-mqtt-e2ee/docs/key-lifecycle.md) |
| AC-04 | Given local EMQX 與另一 broker profile，When TLS、ACL negative 及 opt-in synthetic broker-swap smoke，Then 僅合法端點可通信且 crypto 不依賴 broker | historical | [progress](secure-mqtt-e2ee/docs/progress.md)：local integration 與 public smoke Done |
| AC-05 | Given 現行來源與原生驗證環境；When 執行 make lint／types／test；Then 必要 gate 全部通過且未執行項目明示 | failed | [本次 lint 輸出](../../docs/project-success/evidence/newclear-qualification/wotar-03.log)：test_key_rotation.py import 排序 I001；type／unit 通過但三項 certificate-dependent cases skipped |

## 本次修復計畫（T-0368／newclear #442）

目標：修復 AC-05 的 I001，補跑原本必要的憑證與真 broker gate，維持 AC-01–05。
範圍：import 排序、必要 test runner／CI 及證據文件；不新增 runtime dependency。
先執行未修版本 make lint 保存失敗；再只修排序。測試以獨立 source fixture、
新產生 CA/client/server/keyring、唯一 container 與 loopback 連接埠隔離，
不在既有 certs／config／.secure_mqtt 路徑覆寫任何內容。
重跑 doctor、lint、typecheck、test、coverage（原 86% 門檻）、本機 EMQX integration；
補明三個原 certificate-dependent skip 的實際結果，另核對 opt-in synthetic public broker smoke。
對外 smoke 只允許新隨機 namespace 與合成密文；無法連線則保留缺口，不用 local 替身冒充。
獨立審查、必要 CI、合併與遠端核對前不打標；未滿足全部主線則 usable_tag 保持 none。

## 現況與缺口

2026-10-21 現行 lint gate 未通過，因此保留歷史功能完成紀錄，整體重新驗收與 usable 標記暫不通過；本次不修正產品。


歷史完成是 library/CLI 與本機／合成整合功能，不代表任意 production broker 已部署或審核。
Keyring 檔案以 POSIX 0600 管理；optional passphrase/wrap 是後續保護，不虛稱現有 at-rest encryption。
Public broker 只用合成資料，production profile 拒絕 public EMQX host。
歷史 progress 缺本次目標 commit 的完整輸出與環境對帳，新的可用資格仍須補驗。

這次僅新增驗收入口，未改變 runtime 或原有驗收 oracle。
歷史結果若與現行 source 有相關差異，必須補驗而不能直接繼承。

## 啟動與驗證

在 secure-mqtt-e2ee 子目錄依[README](secure-mqtt-e2ee/README.md)準備 Python 3.12、AES-GCM-SIV、keyring、trusted public registry 與 local EMQX。

已核對入口：[Makefile](secure-mqtt-e2ee/Makefile)與 [package entry](secure-mqtt-e2ee/pyproject.toml)。
下列是該入口既有的啟動或驗證命令，並非本次執行紀錄；
需先完成連結文件中的依賴、設定及適用環境準備。

```sh
make install
make doctor
make test
make test-integration
```

執行後應保留來源 SHA、必要設定的非秘密摘要、命令與結果，
並將 runtime 證據逐項對回 AC；不得只用 health 或 exit 0 宣告全部完成。

## 可用版本

目前 `usable_tag: none`；本次沒有建立或發布任何 tag。
既有版本號、合併紀錄與歷史驗收不自動轉換為可用版本標記。

須將歷史 phase/真 EMQX 證據對齊目前合併 commit，重跑 crypto、TLS/ACL、replay、rotation 與 durable recovery；標記不可宣稱未知 production ACL 或 forward secrecy。
