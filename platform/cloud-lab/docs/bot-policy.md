# Persistent bot policy — BP01–04

本輪交付本機常態 bot 護欄，保留固定 node-health、原 API 與 runner 權責。只開發 source／local；不安裝、不續 live 授權、不呼叫模型、不新增付費。原 Grok status-only 設定不在修改範圍。

| AC | 驗收 |
| --- | --- |
| BP-01 | 私人嚴格政策綁定完整設定 digest；固定最多24小時且不晚於 operator 採集的最早授權／runner期限；離線明確初始化，不自動續期 |
| BP-02 | 同一 SQLite／FLOCK 下持久 call／新ID配額與間隔；先 commit reservation 再網路，失敗不退還，同ID恢復不重扣新ID額度 |
| BP-03 | MCP可信 CLI 傳入政策；重新連線不重置，遺失／改動政策或帳本、時鐘回退、額度／期限拒絕；不讓工具參數改政策 |
| BP-04 | RED/GREEN、實際 subprocess／HTTP 路徑、完整回歸、獨立審查、文件與Git交付；live／模型／其他授權未改 |

## 固定範圍

政策允許更小額度，硬上限為單次租期24個新 request_id、240次有效 bridge 呼叫；新ID至少60秒、呼叫至少5秒。這是整段租期總額，沒有日界重置。每次可至多一個bootstrap及一個command HTTP請求，故240次呼叫最多480次API請求，不含既有runner。這只是本入口請求上限，不是帳號帳單保證。

期限是本機新I/O准入截止，不是撤銷已被遠端接受的命令；最多120秒的既有command執行期限仍由原API／runner判定。到期、時鐘回退及拒絕不產生健康結論。超時後仍保存原ID與payload，禁止換ID猜測重送。

## 信任邊界

政策為owner-only、無symlink的本機檔案（建議0600；沿用private_read亦接受0400等owner-only模式），只從可信CLI指定。完整config SHA256綁定原credential／scope。operator必須先以fresh來源取bot HMAC、grant、Access及runner實際stop的最早期限，填入authority_until；離線工具不會把這個輸入宣稱為已驗證授權。遠端Access／HMAC／grant仍是權威。

初始化是明確管理動作；首次將政策digest存入原requests.sqlite並保留全部既有request。已有政策不得再次初始化或改檔續期。執行期政策必須對應已初始化帳本；遺失帳本不可自動重建配額。新版本對已綁定帳本省略--policy亦拒絕。這是合作工具host的本機護欄，不是同OS使用者／舊版本／複製或回滾整份state的防竄改邊界；不得刪state解限。

啟用與更新需要固定source候選、原state備份／比對、fresh期限及具體方案。政策續期／遷移尚未實作；額度耗盡或到期先停提交並保留state，另行設計顯式續期，不能另建state繞過。

## 私人政策與命令

以下是 synthetic 格式，日期與hash必須由實際候選重新產生；不得複製當作 live 授權。

```json
{
  "schema_version": "cloudlab.bot-policy.v1",
  "config_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "not_before": "2026-11-01T00:00:00Z",
  "expires_at": "2026-11-02T00:00:00Z",
  "authority_until": "2026-11-02T01:00:00Z",
  "max_calls": 240,
  "max_new_requests": 24,
  "call_interval_seconds": 5,
  "new_request_interval_seconds": 60
}
```

hash使用 `tools/live_probe.py` 的 `encode(config)`（排序key、UTF-8、不escape Unicode、compact JSON）之 SHA256，不是原檔案bytes的hash。時間嚴格UTC秒、數字必須整數、拒絕重複／額外key。政策／設定建議0600，讀取器強制owner-only、regular／single-link；state嚴格0700且不在Git內。原state必須保留，不用新的資料夾替代已有請求。

```sh
# 明確離線初始化一次：不送HTTP、不接受模型輸入、不替換舊政策
python3 tools/bot_bridge.py --config /private/bot.json --state-dir /private/bot-state --policy /private/bot-policy.json --initialize-policy
# host啟動參數；--allow-submit仍是獨立可信開關
python3 tools/mcp_stdio.py --config /private/bot.json --state-dir /private/bot-state --policy /private/bot-policy.json --allow-submit
```

MCP參數仍只有request_id。不提供初始化／改政策／重置配額工具。所有進入bridge且通過政策的call（包含本機not_found及ACK_UNCONFIRMED）都扣call額度；被MCP格式或session限流、submit開關、政策拒絕的call不扣。首次新ID在bootstrap前就占名額；bootstrap失敗後同ID可恢復，POST不確定則保持完整已存bytes。原帳本已有request不扣新ID，但查詢／恢復仍扣call。

每次I/O前重驗期限與持久high-water；准入拒絕（包括到期／額度／間隔）亦先保存最大觀測時間，再判定而不扣call／新ID額度；時鐘倒退至該時間之前就拒絕。FLOCK涵蓋全call及網路，其他程序立即STATE_BUSY，不排隊重試。MCP原15秒子程序總期限仍適用；直接bridge CLI沿用socket期限，沒有全程序期限保證。配額在完整commit後才開始網路；被kill、timeout、403或資料庫後續失敗都不退還已commit配額。

| code | 意義／處置 |
| --- | --- |
| INVALID_POLICY / POLICY_CONTEXT_MISMATCH | 私人格式、設定或已綁定政策不一致；停止核對，不自動修復 |
| POLICY_REQUIRED / POLICY_NOT_INITIALIZED | 缺政策／未初始化帳本；不可執行期重新初始化 |
| POLICY_ALREADY_INITIALIZED | 已有政策，不覆寫或重置 |
| POLICY_NOT_STARTED / POLICY_EXPIRED / POLICY_CLOCK_ROLLBACK | 不在准入窗口或時鐘回退；保留state停止呼叫 |
| POLICY_CALL_LIMIT / POLICY_NEW_REQUEST_LIMIT | 整段租期額度耗盡；不換state、不自動續權 |
| POLICY_RATE_LIMITED / STATE_BUSY | 間隔不足或其他call持鎖；host自行停止／稍後同ID再查，無自動重試 |

政策是在本機補上限，不取代任何遠端准入。到期前已開始的HTTP可能於到期後回覆；這不構成延期或新提交許可。舊的未綁政策state仍支援原明確operator模式，不能把該相容路徑聲稱為常態政策保障。
