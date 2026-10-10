# Fresh network stage：唯讀前置證據檢查

## 目標與邊界

依 [fresh executor 設計](M3-FRESH-EXECUTOR-DESIGN-2026-10-03.md) 的每stage重核要求，接續 [replacement facts](M3-FRESH-REPLACEMENT-FACTS-2026-10-04.md)。實作固定 `network-and-access-ready` 的唯讀前置檢查，補上歷史preparation與當次stage authorization／writer-fence之間的缺口。此API不執行、reserve、更新trust或接受stage，也不觀測網路可達性。既有receipt/observation歷史時效語意保持不變。

只有exact同execution的有效pending存在才可通過；absent／foreign／malformed／operation途中改變均阻擋。原pending fence digest仍綁初始execution證據；新stage fence明確引用該prior fence，不能偷換reservation或把舊fence時間更新。

凍結API：`inspect_network_admission(project, run_id, execution_sha, input_file, input_sha, *, now=None, source_state=None)`。raw request SHA必填。成功status `prerequisites-reviewed`，回傳ID、assessment SHA、execution SHA、host_count與固定stage；`stage_accepted`、`executable`、`remote_mutation_performed`、`generation_changed`、`external_fence_verified`均false。失敗只回publicsafe blocked摘要；參數ID/SHA格式錯可raise ValueError。沒有public/private寫入或remote工具。

## Request與新證據

Request精確欄位：`schema_version:1`、`binding`、`replacement_observation`、`owner_authorization`、`writer_fence`。三個ref皆canonical private相對path與raw `sha256`；replacement ref必須位於既有immutable replacement area，且record digest同binding。所有raw bytes、現行source／input／root均需安全重讀。不得接受legacy baseline或偽造summary；必須呼叫既有replacement inspector並重導出receipt鏈。

`binding` 為原execution binding完整欄位，加 `execution_sha256`、`pending_sha256`、`replacement_sha256`、`stage: network-and-access-ready`。型別精確；不可多欄、跨run/generation/stage或重算hash洗白。成功assessment SHA綁exact request/ref與pending，不作可cache的執行token。

新的owner authorization精確欄位：`schema_version:1`、`kind:fresh-stage-authorization`、`binding`、`authority:owner`、`approved:true`、`issued_at`、`expires_at`。issued不得早於replacement完成，`issued <= now < expires`，有效區間大於0且不超過一小時。舊preparation authorization不具新schema/binding，不能代替。

新的writer fence精確欄位：`schema_version:1`、`kind:fresh-stage-fence`、`binding`、`observed_at`、`active:true`、`controller_count:1`、`in_flight_writers:0`、`prior_fence`、`isolation`。prior_fence必須exact匹配execution的writer_fence ref並重讀原bytes；isolation為下列獨立private證據ref。bool不能冒充int。observed不得早於replacement完成且最多15分鐘，不能future。

Isolation證據精確欄位：`schema_version:1`、`kind:fresh-writer-isolation`、`binding`、`observed_at`、`other_controllers_stopped:true`、`ci_writers_stopped:true`、`app_writers_stopped:true`、`old_hosts`。四筆old_hosts依原baseline順序，精確包含 `alias`、`node`、`machine_id`、`boot_id_sha256`、`host_key_sha256`、`isolated:true`、`method`（provider-console或network）、`proof` raw ref。身份必須逐筆等於既有原baseline；四筆proof不重用path或digest，安全讀取非空bytes。isolation時間介於replacement完成與fence觀測之間且最多15分鐘。不得以新host身份代替舊host隔離。Operator仍須提供真實隔離證據；TCP不通／node down不能證明外部fence。此API只核對proof非空bytes與digest，不解析其內容以認證隔離效果。

以上是operator提交的scope-bound attestation與可讀proof bytes；沒有provider簽章或跨控制器lease，不能由schema/hash推論真實外部fence已成立。`external_fence_verified:false`保持此區分。未來dispatcher仍須在當次精確操作授權下重跑gate、驗證真實fence並持有適當mutation lock；此readonly API不提供lock或bypass capability。

## 重驗與測試

本輪測試只有synthetic private fixtures，沒有SSH／VPS／provider。呼叫開始及結束重驗pending、replacement observation、receipt鏈、current source／rawrefs／trusted root，最後重新取時核對所有facts／authorization／fence期限。檢查期間任何漂移阻擋；成功也不是跨檔或跨主機原子快照。

RED→GREEN：成功含新鮮當次證據但歷史preparation已過期；缺pending、錯stage/execution/generation/observation、rawhash漂移、stale/future/reversed時間、bool偽int、少host/舊身份不符、proof缺失/空/reused/pathunsafe、同時pending/input/root漂移、offline syscall零writes/零transport、末端expiry、CLI redaction。獨立審查、完整suite、原workflow與evidence gate通過後才交付。本輪不降低正式剩餘12項。

## CLI

```sh
python3 scripts/labctl.py inspect-fresh-network-admission \
  --run RUN --sha256 EXECUTION_SHA \
  --input private/network-stage-request.json --input-sha256 REQUEST_RAW_SHA
```

CLI公開輸出限定ID／digest／count／status／固定stage及false flags；private path、host身份、key與原始proof不輸出。此命令不進入Operator或ClusterLock，不發SSH，不存assessment紀錄；成功digest只識別已核對的輸入集合，必須重新檢查當前證據才能供後續流程使用。

## 完整 publication 與末端重驗

Inspection在最早讀取時pin execution、原baseline observation及replacement observation三個immutable目錄的descriptor，跨兩次完整讀取保留，再以目前route的device/inode及精確filename集合重驗。目錄被換成相同bytes、補上failure marker或出現extra檔案都拒絕；finally關閉descriptor。只重讀內容hash不足以保證publication仍完整。

末端在rawrefs／source／root／pending／publication重驗後重新取得時間，同時檢查新stage authorization／fence／isolation、replacement 15分鐘facts與receipt 7日期限。assessment digest為canonical `{schema_version:1, operation:fresh-network-prerequisites-assessment, input:{path,sha256}, request}` 的SHA；不包含可當作許可的狀態，不能cache為mutation token。

## 驗證結果

Root focused50tests（30.689秒）、worker指定62（15.336秒）、獨立review及相關72（16.048秒）加worker13（15.671秒）通過。完整 `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v` 679tests（98.009秒），零failure/error/skip。各組重疊，不相加。原workflow AST／JSON／relative links／private exclusion／whitespace、compileall、team task/report與scope/privacy通過。

初版在末端新增failure marker或把publication目錄換為samebytes時仍通過；3項獨立regression覆蓋replacement marker、replacement parent swap、execution marker、original observation marker四種漂移，修正後全部阻擋。真CLI→ops整合通過，沒有mock admission loader；syscall guard確認成功inspection零writes／remote／reserve。僅本輪有界軟體驗收通過，整體仍PARTIAL，不把它當成完整network或fresh executor完成。
