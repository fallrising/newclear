# Resident observation — RO01–04

本輪為Linux resident runner加入明確啟用的私人Unix socket觀測。只有正在持有journal lock的程序，才回應自己實際載入config的digest與stop-at；不讀舊unit／log推定目前狀態。不部署、不啟動原Lab服務、不續權。

| AC | 驗收 |
| --- | --- |
| RO-01 | opt-in observation socket只在resident invocation存在；owner0700 parent／0600 socket、拒絕既有路徑與symlink，結束只移除自己的socket inode |
| RO-02 | fresh challenge回應綁定SO_PEERCRED、PID／boot／start ticks、已載入config digest、journal lock fd／inode；觀測前後回讀程序／鎖／config以拒絕退出、PID重用與漂移 |
| RO-03 | 真實resident輸出實際stop-at及monotonic剩餘准入時間；SIGTERM／SIGKILL、過期、無socket、malformed／slow peer一律不能冒稱有效期限；觀測不開journal或派送 |
| RO-04 | Linux真實程序／Unix socket／持鎖與負向測試、完整回歸、獨立審查及文件／Git交付；live狀態與完整mainline保持未驗收 |

## 介面

Resident顯式加入`--observation-socket /private/resident.sock`；parent需事先建立為owner0700。獨立查詢使用`runner.py --config /private/runner.json --observe-resident --observation-socket /private/resident.sock`。查詢不能混用once、authorization-status或stop-at；沒有網路Cloudflare請求、journal建立或lock取得。舊resident沒有socket時返回固定錯誤，不補歷史值。

Server只接受有界JSON challenge、同UID peer，回傳同challenge、instance、觀測時間、PID／boot／process start、config digest（綁定已載入scope與credential identity）、stop-at／monotonic剩餘時間及已持有lock描述。所有metadata屬私人資料；CLI stdout僅保留來源／時間／期限與明確不完整狀態。無secret、config path、主機名或token。

Observer在短期限內回讀SO_PEERCRED、Linux /proc identity及fdinfo FLOCK owner，核對指定config所對應journal lock的device／inode，並重新讀取config digest及程序／socket狀態。不能由『檔案存在』或『PID存在』通過。新鮮challenge不取代kernel identity／lock驗證；同UID可修改程式與私人資料，這不是抵抗惡意owner或root的attestation。

## 期限語義與限制

stop-at只控制不再開始下一個cycle，不保證硬中斷當前HTTP或採集。報告configured_stop_at及保守runner_stop_at：後者取設定期限和查詢起始時間加monotonic剩餘窗口的較早值，避免時鐘倒退延長。觀測瞬間有程序／鎖不代表健康、網路連通或之後持續運行；不宣稱Access／HMAC有效，deadline_complete仍false。

缺少proc權限、停止／zombie程序、PID重用、config更換、鎖更換、錯challenge、超時或不符合schema都失敗，不輸出可用期限。SIGKILL可能留下socket inode；下次啟動拒絕覆寫，operator先依流程確認該路徑無使用者再處理，不自動刪除或換名。

後續才將來源與AS／self metadata整合，準備指定期限的輪替及部署計畫；本輪不更改原Lab服務／憑證、不啟用Cron或付費方案。


## 實作邊界

Wire schema為cloudlab.resident-observation.v1：challenge、instance、observed_at、pid、boot_id、start_ticks、config_sha256、stop_at、remaining_ms及lock(fd/device/inode)。Config digest是實際載入JSON的canonical SHA256；它含secret的不可逆摘要但仍是私人metadata，不公開保存。沒有回傳scope、credential ID或secret值。雙向同UID peer驗證及kernel FLOCK owner不是跨UID授權系統。

Server單次challenge收取最多256bytes、0.5秒；observer回應最多32KiB、2秒socket交換總期限，逐次recv都使用剩餘期限，避免慢速stream持續刷新timeout。proc／私人檔案讀取屬本機OS I/O，沒有宣稱能硬中斷任意核心／檔案系統阻塞。採`/proc/self/fd/<parent>/<name>`連接已開啟的私人parent，避免長工作區路徑超過Unix socket位址上限；所有parent component拒絕symlink。

正常resident未指定socket時行為不變；啟用時先取得原journal lock、建立runner，再用resident loop實際計算的monotonic deadline啟動觀測；finally關閉socket後才釋放journal與lock。程式在主機不同PID namespace或看不到/proc／fdinfo時失敗，不降級為PID存在檢查。

Socket權限透過O_PATH／O_NOFOLLOW固定inode後，以proc fd引用設定0600，不依賴可選的nofollow chmod支援；[Python 3.11平台支援說明](https://docs.python.org/3.11/library/os.html#os.supports_follow_symlinks)。本機實際測試使用Python 3.13；未安裝／另跑Python 3.11，不將模擬缺少可選功能測試冒稱跨版本實測。
