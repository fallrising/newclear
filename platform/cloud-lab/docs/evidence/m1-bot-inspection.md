# BI01–04 — Bot policy and quota inspection

新增獨立operator CLI及測試；不改既有bridge／MCP／Worker／runner runtime。契約見[BI](../bot-inspection.md)。唯讀原state、綁定config/policy、期限／額度與待對帳ID投影，不呼叫HTTP或消耗call，不將ACK當健康。

17個missing implementation RED後17GREEN；補實際CLI子程序、跨程序writer FLOCK及網路client不可構造，共19GREEN。初次CLI fixture重複傳script argv導致argparse拒絕，修正fixture argv後通過；未放寬runtime檢查。Fixture只屏蔽shared launcher外層Git ancestor偵測，原state自身Git／安全與權限檢查保留，與既有MCP測試一致。

覆蓋期限／not_started／clock rollback、fractional cooldown向上取整、等待跨到期、call與newID配額分離、ACK遺失／payloadless reservation、重複觀測byte及mtime保全、原history跨renewal、20ID截斷、row/size邊界、缺失state不建立、policy缺失不初始化、unsafe mode/symlink/hardlink/FIFO、hot journal／WAL／SHM拒絕、corrupt payload／ledger及config／policy不符。

完整suite初次沙箱run遭loopback／Unix socket EPERM，Node native assertion中止、Python289tests中35errors；原log保留，不能稱通過。允許本機socket後，完整355tests通過（64Node／291Python，零failure／skip）。未放寬測試或產品授權；Node experimental SQLite及既有SQLite ResourceWarning保留。

2026-10-29T18:17:42Z以真正CLI直接唯讀原bot狀態：active，截止2026-10-30T18:00:27Z，quota calls4/240、新ID1/24，歷史2ACK、unconfirmed0／reserved_without_payload0。原DB／lock／config／policy／Grok client內容hash與mtime逐項相同，沒有安裝新runtime、改MCP entry、刷新cloud/self／續權／新增command或模型呼叫。快照remote_authorization／remote_results明確not_checked；不將此讀取當成新的遠端健康證據。

保護證據位於共享launcher的BI-red、BI-focused-green、BI-cli-check、BI-cli-green、BI-full-suite、BI-full-suite-normal及BI-live-readonly。raw private內容未公開；初始完整回歸已通過；其後review修正與最終驗證見下段，Git交付／遠端回讀記於任務板。Python3.11未本機執行；自然到期／模型／帳單／完整主線及HL provider gate仍未驗。沒有新依賴、付費、deployment或usabletag。

T846初審REWORK發現SQLite Row缺欄位的IndexError未收斂，兩個真正CLI malformed-schema測試重現exit1／traceback。主導另以RED重現新ID額度耗盡但冷卻期間只顯示rate-limit；改為明示new-request-limit。新增IndexError／RecursionError固定錯誤收斂，SQL VM budget邊界收緊至200萬。Deep JSON fixture在本機Python3.13被成功解析為非command array，再安全回STATE_CORRUPT；最初錯誤地要求唯一CONFIG_OR_STATE_UNAVAILABLE code的斷言失敗，現要求兩個合理固定code之一、exit2、stderr空及bytes/mtime不變，不宣稱重現了RecursionError traceback。四個新增案例形成23項focused通過；最終完整359tests（64Node／295Python）零failure／skip；[T846 focused複審](../../../../.team/reports/T-846.md)ACCEPT。主導已檢視raw logs、所有source/test diff與原state保全回執，evidence gate接受BI bounded source/local；五項文件／task／diff檢查通過，report及final diff交付前驗證。
