---
project: systems/wotar
purpose: 以自管金鑰在 MQTT 上提供端到端加密的發布與訂閱
kind: tool
mainline: complete
usable_tag: usable/wotar/v0.1.0
reviewed: 2026-10-21
source_commit: 33c9663e7590020fb0147c30e81e7a8db375db2b
qualification: docs/project-success/qualifications/wotar-repair.md
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

下表為 2026-10-21 修復後實跑；[完整證據與失敗歷史](../../docs/project-success/qualifications/wotar-repair.md)。PR443 必要 CI／審查／合併及遠端核對已完成。

| AC ID | Given / When / Then | 狀態 | 證據或缺少原因 |
| --- | --- | --- | --- |
| AC-01 | Given 信任的 publisher 與 keyring，When 加密發布並由合法 subscriber 收取，Then broker 只見密文且 endpoint 驗簽解密 | passed | [本次原生／真 EMQX／public smoke 證據](../../docs/project-success/qualifications/wotar-repair.md) |
| AC-02 | Given 篡改 envelope、錯 topic 或 replay，When subscriber 驗證，Then 不交付未授權 plaintext 且重複訊息被去重 | passed | [本次原生／真 EMQX／public smoke 證據](../../docs/project-success/qualifications/wotar-repair.md) |
| AC-03 | Given 舊 DEK 與新 active key，When rotation 並讀取歷史 ciphertext，Then 按 key 狀態解密且 revoked/retired 邊界遵守政策 | passed | [本次原生／真 EMQX／public smoke 證據](../../docs/project-success/qualifications/wotar-repair.md) |
| AC-04 | Given local EMQX 與另一 broker profile，When TLS、ACL negative 及 opt-in synthetic broker-swap smoke，Then 僅合法端點可通信且 crypto 不依賴 broker | passed | [本次原生／真 EMQX／public smoke 證據](../../docs/project-success/qualifications/wotar-repair.md) |
| AC-05 | Given 現行來源與原生驗證環境；When 執行 make lint／types／test；Then 必要 gate 全部通過且未執行項目明示 | passed | [本次原生／真 EMQX／public smoke 證據](../../docs/project-success/qualifications/wotar-repair.md) |

## 本次修復計畫（T-0368／newclear #442）

目標：修復 AC-05 的 I001，補跑原本必要的憑證與真 broker gate，維持 AC-01–05。
範圍：import 排序、必要 test runner／CI、integration readiness fixture 及證據文件；不新增 runtime dependency。
實跑另重現 TCP proxy ready 早於 broker TLS：前五個真連線 EOF/reset，後續相同憑證通過。
修復計畫加入真 mTLS handshake readiness，並以只開 TCP／真 TLS 兩種合成 listener 回歸，不能只 sleep 或重跑。
先執行未修版本 make lint 保存失敗；再只修排序。測試以獨立 source fixture、
新產生 CA/client/server/keyring、唯一 container 與 loopback 連接埠隔離，
不在既有 certs／config／.secure_mqtt 路徑覆寫任何內容。
重跑 doctor、lint、typecheck、test、coverage（原 86% 門檻）、本機 EMQX integration；
補明三個原 certificate-dependent skip 的實際結果，另核對 opt-in synthetic public broker smoke。
對外 smoke 只允許新隨機 namespace 與合成密文；無法連線則保留缺口，不用 local 替身冒充。
獨立審查、必要 CI、合併與遠端核對前不打標；未滿足全部主線則 usable_tag 保持 none。

## 現況與缺口

I001、憑證缺少造成的三項 skips、TCP proxy 假就緒及隔離 runner 清理缺陷已修復。
原生183 tests、15項真 EMQX integration、1項 opt-in synthetic public smoke 通過，coverage86.49%達原86%。
歷史 skip／五項 TLS 失敗與審查 REWORK 均保留。技術主線與發布 gate 通過；合併及 tag 已遠端核對。
本機／合成 library/CLI 範圍不代表 production 部署、任意 broker ACL、at-rest encryption 或 forward secrecy。
Owner 驗收與技術交付分開。

## 啟動與驗證

在 secure-mqtt-e2ee 子目錄依[README](secure-mqtt-e2ee/README.md)準備 Python 3.12、AES-GCM-SIV、keyring、trusted public registry 與 local EMQX。

已核對入口：[Makefile](secure-mqtt-e2ee/Makefile)與 [package entry](secure-mqtt-e2ee/pyproject.toml)。
下列是該入口既有的啟動或驗證命令，並非本次執行紀錄；
需先完成連結文件中的依賴、設定及適用環境準備。

```sh
make install
python scripts/verify_isolated.py --output /tmp/wotar-check --integration
# 另一 broker 合成 smoke：明確加 --public-smoke
```

執行後應保留來源 SHA、必要設定的非秘密摘要、命令與結果，
並將 runtime 證據逐項對回 AC；不得只用 health 或 exit 0 宣告全部完成。

## 可用版本

已發布 annotated `usable/wotar/v0.1.0`：tag object `c876d5fb906204b5b7ba36234a9d3ef0ca9e91fb`；
peeled merge `9b3d42425b1525cbec01020255444c00bd07f676`（[PR443](https://github.com/fallrising/newclear/pull/443)）。
遠端 ref、tag type 及受驗程式 bytes 已核對一致。
不得移動既有 tag 或冒稱 owner 驗收。
