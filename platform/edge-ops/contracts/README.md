# Edge Ops 契約（v1，M0）

本目錄是 [SDD 05](../docs/sdd/05-contracts-and-security.md) 的機器可驗證落地。前端、後端、Agent 三線都以這裡為唯一 wire 來源；任何 wire 變更先走 contract PR，再同步三線。

**狀態：M0 draft。** 只有 TS（`backend/src/domain/contract/`）與 Go（`agent/internal/contract/`）兩個實作通過同一組向量；尚未有 owner acceptance、獨立安全審查或 Workers/D1 實機驗證，見 [STATUS](../docs/STATUS.md)。

| 檔案 | 內容 | 權威性 |
| --- | --- | --- |
| [`vectors/`](vectors/) | 正反向 fixtures；TS 與 Go 必須逐案得到相同 `code`／`field` | **normative** |
| [`state-machines/job.v1.json`](state-machines/job.v1.json) | Job／attempt 狀態與允許轉移、執行者、證據 | **normative** |
| [`openapi.yaml`](openapi.yaml) | v1 路徑、權限、錯誤碼與 body schema 引用 | 描述；路徑尚未實作 |
| [`schemas/`](schemas/) | JSON Schema 2020-12 | 描述；無法表達 duplicate key、raw bytes 等規則，衝突時以 vectors 與本文為準 |

## Strict JSON

所有 v1 文件（telemetry、enroll、RunManifest、approval）先以同一 profile 解析，再做 schema 驗證：

1. 先檢查大小上限（`too_large`），再檢查 UTF-8（`invalid_utf8`，含 UTF-8 編碼的 surrogate 與 overlong），拒絕 BOM（`bom`）。
2. RFC 8259 文法；註解、單引號、尾逗號、NaN/Infinity 皆 `syntax`；值之後有任何非空白內容為 `trailing_data`。
3. 物件鍵在 unescape 後比較，重複即 `duplicate_key`；巢狀深度上限 32（`depth`）。
4. 只接受整數：小數或指數為 `non_integer_number`，`-0` 為 `non_canonical_number`，超出 ±(2^53−1) 為 `integer_out_of_range`。需要更大範圍的 uint64 counter 一律用十進位字串。
5. `\u` 跳脫中的未配對 surrogate 為 `lone_surrogate`。

驗證順序固定為：`schema_version`（缺少 `missing_field`；非 `<family>.vN` 為 `invalid_field`；N≠支援版本為 `unsupported_version`）→ 未知欄位 `unknown_field`（v1 一律拒絕，不靜默忽略）→ 缺少欄位 `missing_field` → 各欄位依文件順序 `invalid_field`。錯誤帶 `field`（例如 `parameters.unit`、`metrics.net[0].iface`）。

時間一律 `YYYY-MM-DDTHH:MM:SSZ`（UTC、秒精度、年份 ≥2000，拒絕不存在的日期與 offset 寫法）。

## Telemetry（`edgeops.telemetry.v1`）

上限 256 KiB。單位寫在欄位名：`_bp`（basis points，0–10000）、`_milli`、`_bytes`／`_bytes_total`（uint64 十進位字串）、`_seconds`。`metrics` 內每個 baseline 欄位**必須出現**；不支援或讀不到時為 `null`，不得填 0（I-05）。series（mounts／disk_io／net）最多 32 筆、label 不重複、不接受控制字元。去重鍵為 `(node_id, generation, boot_id, seq)`；同鍵不同 body digest 由後端回 409。

## Machine request signatures（`edgeops-req-v1`）

Agent → Worker 的每個 `/agent/v1/*` 請求（`enroll` 除外）帶以下小寫 header：

| Header | 規則 |
| --- | --- |
| `edgeops-version` | `1`；其他值 `bad_version` |
| `edgeops-purpose` | `telemetry`／`logs`／`jobs`；必須等於路由要求的用途，否則 `purpose_mismatch` |
| `edgeops-credential` | `cred_…` |
| `edgeops-request-id` | `req_…`；用於稽核與冪等 |
| `edgeops-sent-at` | UTC 秒；與伺服器時間差 >120 秒為 `clock_skew` |
| `edgeops-nonce` | 22–64 字元 base64url（≥128 bit）；`(credential, nonce)` 重放表見 migration，寫入流程屬 M1 |
| `edgeops-content-sha256` | body 的小寫 hex SHA-256 |
| `edgeops-signature` | Ed25519，unpadded base64url（86 字元） |

簽署位元組為下列 10 行以 `\n` 串接（無結尾換行）的 UTF-8：

```text
EDGEOPS-REQ-V1
<purpose>
<credential_id>
<METHOD>
<path>
<query>
<request_id>
<sent_at>
<nonce>
<body_sha256_hex>
```

**不做正規化，只拒絕非正規形式。** path 必須符合 `^/agent/v1(/[A-Za-z0-9_-]{1,64}){1,8}$`（無 `.`/`..`、無 percent-encoding、無結尾斜線），否則 `non_canonical_path`。query 為空，或 `k=v` 以 `&` 串接、key 嚴格遞增（不可重複）、key `[a-z0-9_]`、value `[A-Za-z0-9_.~-]`，否則 `non_canonical_query`。方法僅 `GET`／`POST`。檢查順序見 `requestAuth.ts`／`requestauth.go`，兩者逐項對應。

## Enrollment（`edgeops.enroll.v1`）

Token 為 256-bit、unpadded base64url（43 字元），伺服器只存 `sha256(utf8(token))` hex。Agent 本地產生 Ed25519 key，`proof` 簽署 `"EDGEOPS-ENROLL-V1\n" || sha256(utf8(token)) || public_key(32 bytes)`，證明持有 key 且綁定該 token。同 token 同 key 可取回既有 node；不同 key 一律拒絕（AC-ID-01）。新節點的 `host_authority` 只能是 `none`／`external`，`mode` 為 `monitor-only`。

## RunManifest 與 approval（`edgeops.run.v1`、`edgeops.approval.v1`）

Manifest 上限 32 KiB，欄位集合固定（見 [schema](schemas/run-manifest.v1.schema.json)）；`parameters` 最多 32 個，名稱 `^[a-z][a-z0-9_]{0,63}$`，值只能是字串（≤1024 UTF-8 bytes）、整數或布林；`not_before < expires_at ≤ not_before + 24h`。

Approval 簽署位元組為 `"EDGEOPS-RUN-V1\n"`（15 bytes）後接**原始 manifest bytes** 的 32-byte SHA-256，演算法 Ed25519。驗證順序：解析 approval → 解析 manifest → digest 相符（`digest_mismatch`）→ key_id 已在本地 pin（`untrusted_key`）→ 簽章（`bad_signature`，含非正規 S）→ node／generation／時間綁定（`node_mismatch`、`generation_mismatch`、`not_yet_valid`、`expired`）。驗簽前不得重新序列化 manifest；向量 `reserialized_manifest_is_not_the_signed_bytes` 即驗證此點。

Approval 私鑰不在 Worker、也不在 Worker 載入的 Web JS（ADR-04）。`bytes.ts` 的 `ed25519SignWithSeed` 僅供測試與向量產生。

## 測試向量

`run-approval.json`、`request-signing.json`、`enroll-proof.json` 由 `backend/tools/vectors.ts` 產生（`npm run vectors`）；key 由公開的 label 以 `sha256("edgeops-test-vector-seed:" + label)` 導出，**只能用於測試，任何環境都不得信任**。`npm test` 會重新產生並比對，防止漂移；Go 測試用同一 label 獨立簽署，要求與向量逐位元相同。`strict-json.json`、`telemetry.json` 為手寫。

## 版本演進

API major、recipe schema、agent capability、executor policy 各自版本化。新增必填或特權欄位、改變簽署位元組、放寬上限，都是 contract PR，並同時更新 TS、Go、向量與本文件。
