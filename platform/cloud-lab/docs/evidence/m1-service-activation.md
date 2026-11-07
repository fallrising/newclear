# Service activation preparation — SP01–04 evidence

2026-10-29，owner繼續開發已提出的常態啟用準備。範圍見[SP契約](../service-activation.md)；沒有cloud mutation、secret生成／輪替、授權續期或服務安裝／啟動。

## Source與本機驗證

SP-red先因不存在plan_service.py而失敗；實作後13個planner案例通過，包含參數上限／bool、scope／identity、已知revocation、busy、unknown／stale、共用Access、估算、私人檔案及CLI錯誤。檔案fixture位於launcher的Git祖先下，只在特定測試patch outside-checkout guard；另有unpatched Git拒絕測試，真正私人CLI未patch。

SP-regression完整42Node／207Python＝249tests通過。Node24.14.0／Python3.13；Python3.11仍無執行檔、未實測，SQLite實驗性／ResourceWarning保留。未改Worker或runner runtime。

## 原Lab唯讀準備（主導證據）

透過現有Cloudflare MCP執行五次固定管理請求：settings、deployments、Cron、指定Access token及唯讀D1 SELECT。settings與目前100%部署比對上輪OL final receipts一致；DB binding正確、active0、schedule off、Cron空；四grant及原Access期限已過，原token身份／enabled／expiry未變，client ID與原runner config匹配。沒有發self／claim或寫nonce；管理面不能讀HMAC secret值，credential層保持unknown。

本機只讀確認原user service inactive／MainPID0、journal鎖可取得、全部既有journal rows completed；讀取前後device／inode／size／mtime相等。保存原unit與metadata，六份SR pinned Git blobs逐檔hash相等；沒有讀取舊private secret內容來假冒新鮮self證據。

SP-private-proposal在Git之外真實執行CLI，原snapshot觀察時間保留，產生時已超過300秒，因此snapshot_fresh=false；credential／runner_stop為unknown，Access共享roles為bot／runner。Proposal明確applied=false、activation_ready=false，runner拒絕把proposal當service policy。候選unit的systemd只讀verify通過，無安裝。初次mkdir parents造成source及source/adapters中間目錄mode0755，完成後逐一改為0700；所有private files0600／dirs0700與manifest再次核對通過，沒有修改既有來源／憑證權限。

主導原始baseline／proposal／source manifest／unit／journal證據留私人持久目錄。獨立審查只接收公開程式、文件、合成測試及上述精簡主導結論，不讀私人raw receipts；T834獨立審查ACCEPT；主導核對全部實際check輸出、private模式與source manifest，接受準備範圍。reviewer未重跑測試、未讀私人receipts或既有helper內部；private-file helper沿用已驗證AL／AS邊界，新增檔案測試由主導實跑。Git結果另記於任務板。

## 限制

7天／60秒為待批方案；10081空閒請求或20161每cycle一report是單程序模型，不是實際帳單／配額。D1讀寫與帳號其他流量未知，Free規則以官方文件記錄，不代表本輪核對了訂閱或帳單。啟用前須重新讀取完整版本／路由／Access policy／grant／主機現況；此準備不冒稱live常態服務、真人Access、排程或完整AC06–08完成。
