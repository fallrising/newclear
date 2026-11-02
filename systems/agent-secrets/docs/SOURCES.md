# 來源與版本紀錄

查閱日期：2026-11-02。方法：GitHub App 讀取固定來源及程式碼靜態檢視；未部署、未執行上游測試，不是完整安全稽核。

上游固定於 `meathill/hsm@0f753b6e393dd938bc53d04294b0bb8ae5b3bb5e`。以下連結不追隨 main／master 漂移；SDD 的 [S#] 對應本表。

| ID | 來源 | 本輪用途 |
| --- | --- | --- |
| S1 | [README](https://github.com/meathill/hsm/blob/0f753b6e393dd938bc53d04294b0bb8ae5b3bb5e/README.md) | 產品主張、API、設定；安全主張須以程式碼校正 |
| S2 | [router](https://github.com/meathill/hsm/blob/0f753b6e393dd938bc53d04294b0bb8ae5b3bb5e/src/index.ts) | Hono、path、CORS、route |
| S3 | [handlers](https://github.com/meathill/hsm/blob/0f753b6e393dd938bc53d04294b0bb8ae5b3bb5e/src/handlers/keys.ts) | CRUD、8192、所有權、明文回應與錯誤 |
| S4 | [HKDF](https://github.com/meathill/hsm/blob/0f753b6e393dd938bc53d04294b0bb8ae5b3bb5e/src/crypto/hkdf.ts) | 字串串接、salt、KEK、info |
| S5 | [envelope](https://github.com/meathill/hsm/blob/0f753b6e393dd938bc53d04294b0bb8ae5b3bb5e/src/crypto/envelope.ts) | v1 格式、AAD、包裝 DEK |
| S6 | [AES-GCM](https://github.com/meathill/hsm/blob/0f753b6e393dd938bc53d04294b0bb8ae5b3bb5e/src/crypto/aes-gcm.ts)、[HMAC](https://github.com/meathill/hsm/blob/0f753b6e393dd938bc53d04294b0bb8ae5b3bb5e/src/crypto/hmac.ts) | IV、Base64、Web Crypto、索引 |
| S7 | [MCP bridge](https://github.com/meathill/hsm/blob/0f753b6e393dd938bc53d04294b0bb8ae5b3bb5e/scripts/hsm-mcp-stdio.mjs) | 三工具、環境秘密、明文 tool result、Content-Length framing |
| S8 | [package.json](https://github.com/meathill/hsm/blob/0f753b6e393dd938bc53d04294b0bb8ae5b3bb5e/package.json) | 依賴與命令；未安裝，未複製 lockfile |
| S9 | [MCP 2025-06-18 transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports) | 固定協定版的 stdio newline framing；非最新版宣告 |
| S10 | [Cloudflare KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/) | 最終一致與原子操作限制；查閱版可能隨官方更新 |
| S11 | [newclear Agent Platform README](https://github.com/fallrising/newclear/blob/244c7f7b416508aedd8f5f8d4a082ae2bb17d022/platform/agent-platform/README.md) | 既有平台邊界；本輪不重建或整合平台 |

## 採用／不採用

採用概念與可觀察契約：Workers＋KV、小型秘密 CRUD、信封加密、HMAC 索引、MCP 介面分層。

不沿用的安全主張：服務端永遠沒有 Part B、服務端不能解密、AEAD 阻止刪除／回滾、CORS 開放即可更安全。這些與資料流或保護範圍不符。

新增設計：Agent 身份、政策、審批、grant、use-without-reveal、撤銷與稽核，全部是本專案 Proposed，不歸功於上游已實作。

## 授權與取證限制

本輪是獨立撰寫的規格，沒有 fork／vendor／複製上游實作；尚未完成上游授權及其依賴的完整盤點。未來重用程式碼前必須核對固定 revision 的授權及必要 notices；不能把 newclear 根 MIT 當成第三方程式的授權。

README 中的測試覆蓋清單不是本次執行證據。上游 static site／所有測試／部署設定未逐檔安全稽核；不得推導部署可用、效能數字或安全認證。
