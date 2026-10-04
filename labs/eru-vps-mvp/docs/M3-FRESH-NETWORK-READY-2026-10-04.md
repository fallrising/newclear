# ERU-015 完整 network-and-access-ready 本機流程

日期：2026-10-04。接續已合併固定 firewall adapter；本輪交付目標為 network-and-access-ready 的可執行本機驗收流程，而非另一個孤立 helper。沿用人工 console 設置 SSH／私網的 approved design；不新增 VPN provider API 或自動登入／金鑰擴權。本輪 synthetic/temp-root/fake transport only，不執行 VPS、真 SSH／nft 或讀寫真實 private。

## 範圍與完成標準

1. prepare／record 先綁定當前 reviewed access plan／admission，不以遠端 directory/staging/firewall 已完成作為準備 intent 的條件；最終 accept 才要求全部現行 journals。初始 OOB admin SSH／replacement facts 是既有前置路徑，不能把本輪說成自動從不可連線的空白 OS 啟動。重用完整四機 directory/staging/firewall journals；必須重新驗證現行 plan、pending、source、近期授權/fence/隔離及所有 raw publication bindings。保留 immutable 歷史 receipts，當前只讀觀測與舊事實分開。
2. 將人工 console 的 effective SSH key／私網設置列入獨立、先於操作的 scope-bound intent 及四機 owner receipts；四個 console action refs 唯一，OOB host keys、實際 private/public endpoints、exact key/trust paths 與 reviewed content hashes 明確綁定。不將 staged files、布林 attestation 或 TCP open 當有效 key 的證據。執行者只準備/保存/驗證這些資料；真正 console 動作另依實際操作授權。
3. 提供固定、只讀 collector：逐台確認 machine/boot/OOB key、指定私網 interface/address、仍未啟動 etcd/core/agent、有效 core→三 workers key-auth + pinned host trust，以及從 controller 的四機 private SSH 與 public management TCP 阻擋。不傳輸或保存 secret private-key bytes。輸入不是任意 command/target/path；core key與probe helper路徑採固定 profile，檢查 owner/mode/no-follow。無法判定、timeout、缺少實際 authentication、route/source 不明或 probe 語意不足都阻擋，不當通過。
4. coordinator 只在全部前置與所有當次 probes 通過後，原子不可覆寫保存 network-stage receipt/evidence；反覆 inspect/recover 只讀、不重播副作用，generation/pending barrier 保持不變。成功明列 next_stage=empty-control-plane；bootstrap 本輪不啟動。
5. labctl 接上 prepare/manual-setup input、collect/accept 與 read-only inspection 的完整入口；預設不 mutation remote。CLI 摘要只 counts/digests/status，不輸出端點/secret/raw private evidence。三模型有界實作與独立審查；root 必跑 focused integration、全部離線 suite、原 CI validator/compileall/team/privacy/whitespace。

## Worker wire agreement

T-257 owns `scripts/fresh_network_probe.py` and `scripts/fresh_network_probe_ssh.py` (including any fixed embedded host program), plus their tests. Export `collect_network_evidence(render, host_keys, *, transport=None, runner=None, now=None)` returning strict bounded JSON-compatible current evidence with operation `fresh-network-ready-probes`, observed_at, four hosts (exact HOST_FIELDS identity, interface/address, effective_access data), three core→worker authentication results, controller-private-SSH results and public-port-denial results. Export `validate_network_evidence(value, render, now)`; it must reject every missing/extra/duplicate/inconsistent record. Both workers coordinate the precise schema before coding; record it in their reports. `render` comes solely from the reviewed immutable network plan; explicitly bound manual-setup public targets/profile can be a separate validated parameter if needed. Fixed SSHReader transport only; injected runners/transports in tests. Both observed IPv4 and any global IPv6 endpoints must be bound and probed; nullable IPv6 is valid only when observations confirm no global IPv6. Public denial must distinguish refusal/timeout from local/no-route/tool errors and verify expected route/source context; unresolved denial is blocker.

T-256 owns `scripts/fresh_network_ready.py` and `scripts/fresh_network_ready_ops.py` plus tests: manual intent/receipt contracts, current-context coordinator, immutable acceptance and readonly inspection. Reuse published current firewall/staging validation; retain four intent/receipt references, validate all predecessor/current authority bindings. Import T-257 validators rather than duplicate the probe contract. Freeze public API/signature and schema with root and T-257 before coding. root owns CLI/documentation/integration; T-258 independent reviewer owns only independent tests/report. No recursive delegation, no actual remote probe this slice.

## Acceptance limits

A passing local flow establishes the manual-console plus fixed read-only-probe route; it does not prove actual VPS configuration, live nft normalization/persistence, full bootstrap, generation commit/seal or three fresh generations. Formal ERU-015 and T-0075 remain PARTIAL until their own complete acceptance evidence exists. Necessary authority, authenticity, crash safety and meaningful probes are mainline blockers; speculative hardening or unrelated refactoring is deferred.

## 完整操作入口

所有操作只針對 private 的 reviewed immutable inputs；本輪只用假的 transport／runner 驗證，下列不在本輪實際執行。

```sh
python3 scripts/labctl.py prepare-fresh-network-ready --plan PLAN --sha256 PLAN_SHA --authorization private/setup-auth.json --authorization-sha256 AUTH_SHA --input private/setup.json --input-sha256 SETUP_SHA
# 綁定實際 scope 的 owner console 動作完成後，才匯入 after-action receipt。
python3 scripts/labctl.py record-fresh-network-ready --run RUN --intent-sha256 INTENT_SHA --receipt private/setup-receipt.json --receipt-sha256 OWNER_RECEIPT_SHA
# 此入口會進行固定唯讀 remote probes；需於實際操作範圍獲准後使用。
python3 scripts/labctl.py accept-fresh-network-ready --run RUN --manual-receipt-sha256 MANUAL_RECEIPT_SHA
python3 scripts/labctl.py inspect-fresh-network-ready --run RUN --receipt-sha256 NETWORK_RECEIPT_SHA
```

prepare／record 不設定主機或安裝 VPN/key；console setup 是 approved design 允許的人工路徑。accept 驗證實際 key authentication，不接受使用者直接匯入的 probe JSON 代替 collector；inspect 不重播 remote operations，也不刷新歷史 probe freshness。stage receipt 是 bootstrap 前置，不是 generation acceptance。

人工 authorization 必須包含 `setup_sha256`，精確等於 setup input 的 raw SHA；四機 public IPv4、nullable IPv6、console refs、worker 完整 authorized_keys SHA、core key/trust/helper 路徑與 hash、controller egress 一起綁定。worker 有效 authorized_keys 保留 reviewed controller admin keys，精確限制的 core line 必須只出現一次；不可覆寫成 staged core-only 候選。

## 本機驗證與實際限制

root focused 命令 `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=tests python3 -m unittest -v test_fresh_network_ready_integration test_fresh_network_ready_cli test_fresh_network_probe test_fresh_network_probe_ssh` 通過23項／86.246秒。integration執行真正 copied-source probe bundles，但 transport、OS roots、工具回應及console皆為synthetic；明確驗證雙協定、拒絕 none authentication、immutable acceptance／只讀inspection與pending不变。曾有integration匯入path與fixture host-key來源不匹配，已修正；原候選完整測試因必要ordering修改中止，不作最終通過證據。

initial admin management route 與 OOB SSH trust 必須先可用，供既有 replacement-facts／access plan 使用。本輪完成在此管理路徑之上的 manual-console network/core-access route；不聲稱替完全不可連線 OS 自動建立VPN。console receipt 必須忠實報告已完成動作：core known_hosts 使用 staged資料，實際console completion可位於file staging後；prepare先建立intent不要求所有helpers已完成。完整directory/staging/firewall current chains仍是accept的必要條件。

固定profile採 root core key `/root/.ssh/eru-fresh-core`、worker `ckc` account；保留controller admin keys，逐台完整authorized_keys SHA由ownerreviewed setup綁定。每host一個publicIPv4與至多一個globalIPv6，發現額外globalIPv6就阻擋而不是忽略；publicIPv4的provider映射仍依exactconsole attestation。collector觀察on-disk sshd設定並驗證實際認證，沒有宣稱cryptographic daemon reload證明。初始／前置授權與所有當次證據維持既有15分鐘期限，歷史receipt不刷新期限；長流程的evidence renewal仍需接續主線實作。

ERU專用CI timeout從20延至30分鐘，容納現有完整suite與新整合流程；保留全部checks、triggers、權限、依賴。最終完整suite／獨立review／CI及交付見本輪evidence gate。沒有release/deploy/真實SSH/nft/VPS或既有private資料操作。
