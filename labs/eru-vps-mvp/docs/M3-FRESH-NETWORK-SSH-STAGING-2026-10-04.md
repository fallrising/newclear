# Fixed SSH file staging adapter 與主機端發布

## 目標與邊界

接續 [staging coordinator](M3-FRESH-NETWORK-STAGING-2026-10-04.md)，實作固定SSH adapter及standalone Python標準庫host helper。沿用既有action/observation schema，不啟用nft、effective authorized_keys、服務、controller trust、generation或stage acceptance。本輪不新增execute CLI、不讀真private、不連SSH或操作VPS；驗證使用temp roots、fake transport及本機helper contract。原有coordinator唯一intent/current authorization/fence/pending gates不可繞過；adapter本身不是授權入口。

已存在的`/etc/eru`必須root:root且0700、非symlink；helper不建立或修權限。這是明確bootstrap前提，裸OS facts原本要求該path不存在，後續仍須獨立且有durable intent的directory preparation；不可把本輪當成從bare OS到network-ready的完整入口。無新runtime dependency。

## 凍結協作介面

Host module `fresh_network_staging_host.py` 必須只import標準庫，提供：

- `validate_request(request)`：零IO，嚴格bounded schema；回傳防禦性copy。
- `handle(request, *, root='/', owner_uid=0, owner_gid=0, now=None)`：helper核心；root/owner/time注入僅供直接import的本機fixture，wire不得包含這些欄位。
- `main(encoded)`：只接受base64 encoded strict JSON request；固定呼叫`handle(request)`的production預設值，stdout只有成功observation JSON，失敗只generic error/非零exit。不自動在module import執行，供固定program末行呼叫。

Wire request精確：`schema_version:1, operation:observe|stage, action`；stage另且必須有`intent_sha256`。大小最多256KiB，duplicate keys/NaN/depth超限拒絕。Action與前輪固定schema完全一致，index type int 0..3；alias為既有四機固定順序、node worker-1..4；canonical private IPv4沿用明列ranges；IDs/hash/content要bounded/type exact，files恰兩個、mode字串0600，UTF8 content各最多64KiB且sha256正確。固定path依core/worker限定，禁止額外檔案、command/options/root/owner override。helper只驗payload形狀/完整性與身份；完整政策仍由coordinator重新derive並授權。

Transport module `fresh_network_staging_ssh.py` 提供 `SSHNetworkStagingAdapter(host_keys, *, transport=None)`，host_keys精確alias→canonical Ed25519 public key四筆，distinct。方法`observe(action)`及`stage(action,intent_sha256)`；`build_program(request)`以固定host module source加`main(BASE64)`製作script。必須在transport之前validate action及host key digest對應，拒絕未知alias/endpoint/key。呼叫transport(host, source, key)一次，回傳bytes；預設可重用既有SSHReader的固定argv/capture，但不得弱化其known_hosts/memfd/OOB/timeout/limit/no-config/no-forward/no-retry契約。固定remote command `sudo -n python3 -`，不在command中拼入request。無credential或trust檔案寫入。全部adapter exceptions重新包裝為generic ValueError不漏request/原error文字。

Observe response沿用前輪schema，bounded strict JSON，exact host、directory、file path/order/type/hash/mode/provenance；只允許兩檔皆absent或兩檔完整published，mixed/未知狀態fail closed。Stage response必須為完整且兩檔intent_sha256等於傳入digest；coordinator仍另外observe，不把stage回值當receipt。時間的current authority gate仍由coordinator核對，helper的observed_at使用當次UTC，不能以caller wire覆寫。

## 主機端身份與檔案安全

Descriptor-relative no-follow：固定root→etc→eru，核對owner與unsafe permissions並pin路徑身份；不追descendant symlink。每次before/write/complete/observe前後讀取並核對`/etc/machine-id`、`/proc/sys/kernel/random/boot_id`與`/etc/ssh/ssh_host_ed25519_key.pub`的canonical Ed25519 digest；public key檔可有comment但只取type/data。所有read bounded、regular、安全owner/links，讀取前後身份與bytes穩定。Proc boot-id可能stat size=0，不以size=0當空內容。IP是已pin transport端點與action binding，不宣稱觀測了kernel interface或tunnel。

Stage須在實際寫入前重驗身份、實體目錄與兩目的檔案absence。兩檔任一存在即拒絕，matching bytes亦不可採納。以`/etc/eru/.fresh-network-stage/`單一固定no-clobber目錄claim，先fsync parent及immutable intent，再發布任何payload；不同request/intent不能取得新slot重播。

Remote intent精確保存schema_version:1、action、intent_sha256；operation由action辨識。Complete精確保存schema_version:1、action_sha256（與既有plan_digest canonical JSON一致）、intent_sha256、files（兩筆path/sha256）。完整journal只能含intent.json與complete.json。每個record及兩個payload都必須同目錄暫存→file fsync→原子no-clobber link→unlink own temp→directory fsync，核對原raw digest與path identity；拒絕hardlink/unsafe mode，完成payload nlink=1、uid/gid root、0600。intent/complete也受相同safe read限制。成功後再次讀回全部bytes/identity/journal exact entries才返回observation。

任何late failure保留claim、已寫payload及可辨識failure marker，絕不自動覆寫、rollback、刪除他人檔案或重試stage。另一個caller未獲claim不得污染winner。Partial/unknown/temporary/failure狀態observe必須拒絕；完整stage回應遺失後observe可由exact persisted action/intent+file hashes產生相同provenance。Observe無任何filesystem寫入/syscall或transport retry，不將caller提供的intent值當完成證據。這是root-controlled journal assertion，不是抵抗已遭入侵root的密碼學認證。

## 驗收

T-240 host helper：RED existing path/symlink不可overwrite；temp-root真fsync/link/no-clobber/crash/partial/concurrentwinner、身份/owner/mode/hardlink/directory swap/原bytes drift、raw record integrity、完成後readonlyobserve與different intent拒絕。

T-241 adapter：RED trust mismatch零transport；固定argv與stdin script、一次dispatch/no retry、strict malformed/oversize/mixed/foreign response、private error redaction、module source compile、沒有wire root/owner override。

T-242 independent：獨立temp-root及fake transport負向測試，源碼與wire／host安全審查。Root另做coordinator→real adapter→real helper(temp root)整合，失回應只observe，不使用真SSH；non-root fixture可顯式以owner_uid/gid注入，整合的fake transport僅在測試中將該fixture owner映射成root metadata，不宣稱測到真root部署。

所有必要tests、full native suite、原workflow/compileall/team/privacy gate通過才交付。正式剩餘12不變；network activation/observations、directory preparation、完整bootstrap、generation commit/seal與三次live generation仍待後續。

## 整合與審查紀錄

獨立審查重現 claim mkdir 後、開啟前目錄被替換，早期候選會污染替換後的 journal；修正後在mkdir後取得dev/inode，開啟後比對並確認empty，取得claim身份後才允許intent或failure marker寫入。非空及空replacement兩個獨立回歸均通過。另補合法 UTF8 payload wire 編碼邊界回歸：JSON ASCII escaping 原本會把兩檔各64KiB的內容膨脹到wire上限外，改以UTF8直接編碼，大小限制不變。

Root integration 使用真正coordinator、adapter與host helper及獨立temp roots，覆蓋core staging／離線inspection、worker回應遺失後只能observe復原，以及remote before-write race不覆寫foreign bytes且不重播。所有實機部署、root權限及網路可達性仍未驗證。最終接受須以 evidence gate 的實際命令結果為準。

安全界限：mkdir與首次stat不是單一原子kernel操作；檢查能拒絕已pin身份之後的替換，不能抵抗有root權限的惡意writer。需要可信root與操作隔離，重驗也不構成原子全機snapshot。這些限制不因本機tests通過而消失。

## 最終本機證據

Root focused60 tests／10.397秒、獨立review57／0.479秒、full811／318.087秒全部通過，full無failure/error/skip。compileall、原workflow及team validators通過。[T-243 evidence gate](../.team/reports/T-243.md) 接受本輪adapter/helper；整體仍PARTIAL、正式剩餘12。下一步為獨立durable directory preparation，再接activation／bootstrap／generation與實機驗收。
