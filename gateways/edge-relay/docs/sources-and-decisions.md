# 來源、抽取邊界與 ADR

查核日：2026-11-02。以下均為來源事實或設計決定，不將公開文件當成本案 runtime 證據。不匯入第三方程式碼。

## 官方來源

| ID | 來源／固定點 | 支持的事實與用途 |
| --- | --- | --- |
| S1 | [Alma Relay README](https://github.com/yetone/alma-relay/blob/716d4a8cd68e13227ec2dc7e3b92923180ac8e9a/README.md)、[protocol](https://github.com/yetone/alma-relay/blob/716d4a8cd68e13227ec2dc7e3b92923180ac8e9a/docs/PROTOCOL.md)、[Worker](https://github.com/yetone/alma-relay/blob/716d4a8cd68e13227ec2dc7e3b92923180ac8e9a/cloudflare/worker.mjs) | 主動 WSS、HTTP/SSE/WS、多工、CF per-desktop DO；抽取 topology，不沿用 wire/auth；MIT 參考，未複製碼 |
| S2 | [Cloudflare WebSocket Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) | DO 可休眠並保留連線；記憶體重建，attachment 可恢復 socket metadata；活動 I/O 不等於免費 |
| S3 | [DO State API](https://developers.cloudflare.com/durable-objects/api/state/)、[lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/) | acceptWebSocket、attachment／auto-response；未完成 I/O／timer 與休眠條件 |
| S4 | [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)、[limits](https://developers.cloudflare.com/durable-objects/platform/limits/) | Free 可用 SQLite-backed DO，仍有額度與 runtime 限制；須部署前再核對 |
| S5 | [ntfy configuration](https://docs.ntfy.sh/config/)、[iOS instant notifications](https://docs.ntfy.sh/config/#ios-instant-notifications) | 自架 iOS 即時通知需 upstream/APNs；ACL/token 與可達性另行配置 |
| S6 | [Finb/bark-server](https://github.com/Finb/bark-server) | 可自架的 Bark backend；不是通用 APNs bundle 憑證 |
| S7 | [Finb/Bark](https://github.com/Finb/Bark)、[Bark docs](https://bark.day.app/) | Bark iOS App 使用 APNs；自架 server 與 App 配合，不讓任意 App 被喚醒 |

Alma 固定參考 commit：`716d4a8cd68e13227ec2dc7e3b92923180ac8e9a`（2026-11-01）。ntfy/Bark/CF 文件未做 source-code vendor；後續實作必須鎖版本並重新驗證，不能把本次 docs 查核當作特定部署的測試。

Repo 規範基準：`244c7f7b416508aedd8f5f8d4a082ae2bb17d022` 的根 AGENTS、docs/project-success.md、docs/taxonomy.md、README catalog。讀取共用交付規則後仍服從本次 Draft-only／不合併邊界；不把私有資料抄進公開 repo。

## 抽取／捨棄矩陣

| Alma 特定做法 | 本案處理 | 原因 |
| --- | --- | --- |
| 桌面主動 WSS 到 relay | 保留為 Endpoint Connector | NAT 後連線模式可重用 |
| 每桌面 DO | 抽為每 tenant/target EndpointDO | 避免全域單一物件與跨租戶路由 |
| Alma hreq/wopen 協定 | 不相容，設計版本化 stream contract | 業務／安全／流控假設需明確 |
| connect code / token hash | 改為 locator、admission、device grant 分離 | routing 不能等於 authorization |
| Alma App + APNs | endpoint-side NotificationPort + ntfy/Bark | 不綁定某個 App 簽署憑證；不聲稱移除 APNs |
| 不落盤 relay | body 不落盤；必要控制 metadata 可 durable | 撤銷與 epoch 需跨休眠／重啟 |
| E2EE 能力 | 保留為安全要求，不複製 crypto 實作 | D-01 尚未選型／驗證，正式可用前硬門檻 |
| TURN credentials | 非 v1，後續獨立 adapter | 媒體流與普通 WSS 控制面不能混為一談 |

## ADR 摘要

- ADR-001（proposed）：CF-first、provider-neutral ports；Node parity 後置，避免把 CF 平台細節擴散到業務。
- ADR-002（proposed）：transport 與 notification 分離，通知從 endpoint 的已批准事件來，不讓 relay 解密觀察業務。
- ADR-003（proposed）：無 business replay／離線 queue／exactly-once，避免在連線元件偷偷引入 workflow engine。
- ADR-004（proposed）：有限 HTTP/SSE/WS adapters＋local allowlist，不做任意 TCP／SSH。每個新 adapter 都需安全 review。
- ADR-005（blocked by D-01/D-04）：敏感主線必須 E2EE；先做合成 trusted-relay-lab，不宣稱 TLS-only 等價。
- ADR-006（proposed）：必需控制 metadata durable、payload transient；hibernation 可重建，無法重建 stream 要顯式失敗。

## 未解決決策與驗證責任

| ID | 決策 | 關閉條件 | 截止 gate |
| --- | --- | --- | --- |
| D-01 | E2EE implementation/profile | 固定成熟 library/protocol、interop/test vectors、獨立安全 review，凍結 wire | M2／AC-011 |
| D-02 | CF restoration 與 platform buffer 邊界 | 真 CF hibernation/deploy/slow-consumer 證據 | M1 基礎、M3／AC-013 |
| D-03 | ntfy/Bark 版本／iOS delivery route | 鎖版本、真機前景／鎖屏／不可達測試 | M3／AC-012 |
| D-04 | Browser bundle 與 session authority bootstrap | 可信分發、origin/cookie/ticket/CSRF 測試，不能由惡意 relay 偷換 key | M2／AC-011 |

責任歸各里程碑 implementation owner 與 reviewer；目前尚未認領 runtime 工作，不偽造實作者。
