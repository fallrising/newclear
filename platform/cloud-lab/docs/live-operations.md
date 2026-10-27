# 首輪部署與接手操作

此文件保存固定操作順序；實際 target／IDs／credentials／journal 與逐步 receipts 位於 operator 的私人持久目錄，不能進 Git 或 disposable cache。[本輪證據](evidence/m1-first-live.md)區分已通過與缺口；重接手先讀最新 checkpoint，再按 receipt 與 API 回讀對帳，不依此文件盲目重建。

## 前置條件

1. 確認已批准的唯一 account、zone、hostname、獨立 Worker／D1 名稱與 non-root runner。查既有資源及精確 DNS record；碰到已有物件先對帳，不覆蓋其他產品。
2. 依 [無桌面 OAuth](headless-oauth.md)取得必要 scopes，做最小只讀驗證。既有 scopes 足夠就不再登入。Free／零新增付費是操作限制；到免費配額就停止，不能以升級繼續。
3. 先跑正常測試與固定 toolchain 的 actual workerd／D1 qualification，再做獨立審查。Node SQLite 替身不能證明 Cloudflare bindings。

## 建立與發佈順序

1. Access app 使用精確 owner allowlist；新增限時 machine service token，立即0600保存一次性 secret。機器 policy 是只包含該 token ID 的 `non_identity`，不是 bypass。回讀兩項 policy。
2. 新建獨立 D1；在 qualification table 做並發 CAS 與故意失敗 batch 的回滾驗證。成功後才套產品 migration 及整份 grant seed；回讀四個 grants、schedule disabled、commands empty。
3. 以已查證的 Access user ID、app audience、D1 ID 產生 [private bundle](deployment-bundle.md)。grant window 不超過24小時，且早於外層 token 到期；不同 bot／runner HMAC key，禁止 wildcard。source與bundle逐檔比hash。
4. 新建 Worker 時明確 `subdomain.enabled=false`、`previews_enabled=false`。以 asset manifest 建 upload session，按 buckets 上傳 exact bytes，再將 completion JWT、modules、DB／ASSETS與 secrets 一起上傳。上傳 token 是短期獨立 bearer；不得輸出或放 argv。可依 [Cloudflare direct upload](https://developers.cloudflare.com/workers/static-assets/direct-upload/)操作。
5. 回讀 Worker version 的 assets routing、bindings、subdomain與Cron設定。所有資產都要經 Worker；沒有Cron。再次核對 hostname 無其他綁定，再attach指定hostname、關閉其preview routing。

每次 mutation 前保存 request／intent，回應與錯誤存獨立 receipt，private目錄0700、檔案0600。工具無法將敏感回應直接保存時，可在已授權 operator host 以既有MCP憑證發相同MCP請求，私下落盤；這不是 Cloudflare API token，也不能直接作上游 API bearer。登入／scope問題不能用新建靜態token或放寬policy偷偷解決。

不覆寫既有receipt。遇到 timeout或回應未知先查實際物件，不自動重播create；半套bundle或過期upload session亦要保留。只檢查最外層HTTP／API success不足夠，D1 export還須核對其內層success/status。

## 有界實際驗收

1. [live probe](live-probe.md)預設只讀；匿名入口、service-token＋HMAC、scope與bootstrap均通過再提交。若Cloudflare回1010，保留原結果；本輪product User-Agent修正已進client，不需再臨場推理或更改WAF。
2. 明確 `--submit-readonly --wait-seconds 0` 保存並提交一個固定檢查。`accepted`／exit1 尚不代表執行成功。
3. 使用當前已驗證source與持久config，在指定non-root host跑 runner `--once`。保存source hash、退出碼、journal；不以不斷重跑collector解決不確定結果。
4. 以**原 evidence** `--resume --submit-readonly --wait-seconds 10` 對帳同一 command。不要刷新key／bytes／deadline。只有 `validated`、validator passed及新鮮觀測才算本輪執行通過；unhealthy可以是真實觀測，unknown不能塗成green。
5. 查D1 command終態、active數、schedule／firings及CF Cron。手機／瀏覽器另實測；service token通過不能代替human JWT或可用性。

## 備份與後續

runner journal用SQLite online backup或正確停止寫入後的整套檔案保存，包含WAL風險，不直接複製仍在寫入的單檔。D1使用官方export polling，完成後以signed URL下載到已批准private目的地；token／URL不公開。若審批拒絕資料傳輸，保留缺口並取得該動作的明確授權，不改用其他通道繞過。

還原只進新建隔離DB，不綁Worker／hostname、不啟用schedule；比較schema／資料與journal，未完成工作先對帳。這項操作成功才可填還原證據，不能由備份檔存在推論可恢復。

本輪沒有常駐runner。grant／Access token到期不會自動續期；下一輪先核對窗口和原有未完成命令，再由可信operator輪替／延長，不能重建journal清空unknown。排程、長期runner、Grok調度與agent adapter須通過各自後續gate。

## 已實測的隔離還原細節

[首次還原證據](evidence/m1-isolated-restore.md)保留成功與失敗。Export開始後立即以at_bookmark作current_bookmark有界poll，檢查內層success及complete才下載；不要隔很久才poll舊export。備份只寫入批准的private目的地，排他建立0600並fsync檔案及目錄。

Import依官方init回應的signed URL PUT原始SQL，校驗ETag與原檔MD5，再用同filename／etag呼叫ingest並有界poll。另保留SHA-256。還原後用該SQL載入的本機schema／rows比較六張應用表，不拿一個稍後變動中的source查詢當作快照oracle。D1的`_cf_KV`只作明示平台schema例外，不能查其內容；遠端用quick_check及foreign_key_check，本機SQLite才使用integrity_check。

不能假設備份時active必為0。列出每個未完成命令的attempt／external reference與journal狀態；本次accepted、無attempt、無journal的命令被原樣保留，沒有派送。若是started／unknown或證據不一致，保留並停止恢復派送，另做對帳。全體Worker binding回讀確認restore無綁定，live仍用source；這證明隔離還原，不等於正式failover成功。
