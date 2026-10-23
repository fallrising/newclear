# ojbquay 可用版本資格

RESULT: PASS
Project: systems/ojbquay
Tag: usable/ojbquay/v1.0.0
Source: 71ac5f775f9c93d679a2b0b3896ddce0d713594a
Startup: `make validate-deploy` 與 `make e2e` 本機 Compose 十一服務 readiness — passed
Core: gRPC 發送到 HTTP push 精確 payload、配置 561 ms 收斂、控制面停止仍交付、真 stack console 旅程含 DLQ replay、Java↔Go pull interop — passed
Checks: `./gradlew clean build` 153/0、Go vet/test、console unit/build/mock e2e — passed

範圍：本機 Compose 上的 Kafka-first v1 功能主線。全路徑 at-least-once；pull ACK 需 gateway affinity；offset reset 結果未知時需人工處理。不是正式部署、HA 或容量認證。

證據：[2026-10-22 實跑](../evidence/ojbquay-mainline-20261022/README.md)。合併前 PR CI 與 owner 同意是建立上述 tag 的 gate。
