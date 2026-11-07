# 安全、配對與信任契約

上位：[SDD](../SDD.md)。相關：[protocol](protocol.md)、[notifications](notifications.md)。目前沒有安全實作或審計證據。

## S-01 Threat model

保護：本機 API／檔案內容、裝置 key、操作授權、provider key。攻擊者可知道 relay URL/route_id、控制一個未授權 client、重播 frame、慢速耗盡資源；E2EE profile 還假設 relay/operator 可能惡意。

不承諾防禦已被攻陷的 endpoint OS、使用者主動批准惡意 client、流量分析、全網 DoS 或遭替換的 client 軟體。relay 可觀察 IP、時間、大小、route/session 關聯；E2EE 不隱藏這些 metadata。

## S-02 三層授權

1. Admission：允許某 principal 使用 relay，控制成本與濫用，不代表可操作某 endpoint。
2. Pairing：端上持久裝置 key 與 client key 建立關係；使用 owner 批准與指紋確認，而非僅信任 relay 宣稱。
3. Capability：端上 Grant 包含 client_key_id、endpoint_id、service_ids、actions、expires_at、policy_version；每次 OPEN 在 endpoint 再驗證。

service 可分 `read`、`stream`、`write`；預設只有顯式 read routes，沒有 shell。高風險業務仍可要求本機人工批准；transport ACK 不等於批准。

## S-03 配對與 bootstrap

endpoint 在本機顯示 256-bit 隨機單次邀請，5 分鐘到期；伺服器僅保存邀請 verifier／必要 metadata。短碼若另提供只能做 locator，不能成為唯一秘密。邀請最多一次使用，端上本機確認 client public-key fingerprint 與請求 scope 後才寫 Grant。

不在 URL query、公開 topic、分析日誌放長期 secret。使用 QR 時 secret 放 fragment／App 本機儲存；頁面立即清除 fragment，禁止第三方 script、referrer 洩漏與追蹤像素。即使 fragment 不由 HTTP 傳給伺服器，頁面 JS 仍可讀到，不能把它當作免受惡意 web host 的保證。

Browser：client bundle 必須來自可信、受控且版本固定的分發來源；**若惡意 relay 同時能替換 browser JS，單憑 wire E2EE 無法抵禦它**。敏感 profile 要求獨立可信前端或已驗證 native/CLI client；CSP、依賴鎖定、供應鏈與更新機制納入 D-04。

## S-04 撤銷與 session lifetime

owner 可由本機管理入口撤銷 client key、grant 或 endpoint admission；policy_version 持久遞增。endpoint 立即拒絕新 OPEN，終止受影響 streams；控制面同步 DO 關閉對應 sockets。舊授權不可因 hibernation／部署復活。

收到本機撤銷後，端上拒絕是安全底線；控制投影傳播目標 5 秒，不將網路故障下的 5 秒視為保證。client session 最長 15 分鐘；到期即停止資料、重新授權。relay 端版本不能覆蓋端上較新的撤銷。

失去裝置／key：人工重新 enrollment；不提供 email 自動復原到舊 grant。credential rotation 需要 overlap/revoke 流程，沒有全域永久 shared master token。

## S-05 E2EE release gate（D-01）

M2 必須選用現有且可維護的 authenticated key-exchange／secure-channel library；不要在此 repo 自製 ECDH+nonce 規則。選型證據至少包括維護版本、授權、跨 browser/native/CLI 測試、test vectors、可靠的 entropy/key storage、rekey、重播／順序／truncation 防護及獨立 reviewer。

協定須綁定雙方 key、profile/version、session/epoch 與 transcript；directional keys、record counters 與重連重新握手由成熟 protocol 定義。端上拒絕 plaintext OPEN，無 crypto profile 共同支援時完全拒絕。relay 注入 plaintext／替換公鑰／重播舊 record 不能造成 local service side effect。

本規格只固定安全性質與拒絕規則，沒有凍結 crypto byte format；D-01 未關閉前不能寫「E2EE 已完成」或標可用。選型可能影響 frame overhead，必須更新 protocol fixtures 而不破壞 resource budget。

## S-06 Local service 安全

設定由本機 owner 管理，例如 service_id `status-api` → loopback HTTP；client 只能給相對 path。每次正規化只一次且一致，拒絕 absolute URL、encoded traversal、NUL、userinfo、非法 authority、dot segments 等模糊輸入。method/path schema 各自 allowlist。

預設只允許 loopback 或顯式 Unix socket；不把 RFC1918 全段自動視為安全。不解析 client-supplied hostname、不跟隨 redirect、不接受 Docker socket／cloud metadata endpoint。若未來允許 DNS target，須固定 allowlist 並對每次實際 connect IP 再驗證以防 rebinding，另經安全審查。

移除 hop-by-hop／credential headers，限制 body 與 message size，local server 原有 auth 不被取消。connector 以非特權 user 執行、私鑰檔權限最小化、無 SSH／shell passthrough。

## S-07 Secret、log 與濫用

relay credential 用部署秘密儲存；endpoint key 與 provider token 用 OS secret store／受限本機檔案，不入 Git。存稽核時只記 synthetic correlation ID、結果、byte counts、latency、policy version；不記 body、query、pairing secret、topic、device key 或完整 route。保留期預設 7 天、可停用；稽核與 DO 控制狀態是刻意存在的資料，不宣稱完全不落盤。

Admission rate cap、ticket cap、4 sessions／32 streams、frame limits 與每日用量停用閾值必須可設。未授權請求不能無限建立 DO 或通知；Worker 在 DO routing 前先拒絕。quota 超限 fail closed；不自動升級付費。
