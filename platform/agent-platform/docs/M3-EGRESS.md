# M3 第七個切片：固定節點出站政策

AT-07 的出站路徑現在有可驗收的 `node-egress-v1` 契約：固定 none-lane guest 只透過 **已啟用、具明確 allowlist 的 host proxy** 對外連線；connector 核對真正執行的 sandboxd 與其不可改寫配置。**AT-07／M3 仍未整體完成**，model proxy／budget／usage 仍未實作，模型仍是固定 fixture。

## 差距與選擇

SDD §11.3 要求出站政策由執行層落實。PR #34 的 connector 只指定 `net=none`，沒有登錄或核對 sandboxd 的出站政策。固定 sandboxd 0.1.12 即使 guest 沒有 NIC，仍可由 silkd 的 loopback 3128 → vsock 2049 → host proxy 出站。舊驗收中 proxy 沒啟動、連線失敗，不足以證明 allowlist 或 IP guard 有效。

本切片重用固定 sandboxd 的資料路徑，不增加 guest NIC、不 fork 上游、不新增 host 工具執行 fallback。上游沒有 live policy readback／替換 API；`PUT /v1/pools` 明確拒絕 `egress`，暖池數量變更不會修改既有 proxy。故採 **drain 後重新啟動的不可變節點政策**，不宣告支援即時政策撤銷。

## 強制邊界

- 只接受 exact lowercase ASCII DNS 主機、明確埠及方法。80 僅 GET／HEAD，443 僅 CONNECT；空 allow 明確 deny-all。拒絕 wildcard、literal IP、任意埠、空 methods／ports、SOCKS、credential injection、TLS interception 與 private-IP override。
- 節點只允許單一固定 template／none／large／zero-warm pool、四 claims、loopback API、audit log。拒絕 tenant、bridge／CNI、mesh、preview、egress CA／secrets／`egress_internal_allow` 等擴大路徑的配置。
- `python -m agent_platform.egress_node` 核對固定 Linux amd64 sandboxd binary SHA-256，完整 node config 寫入 0600 Linux memfd，再套用 WRITE／GROW／SHRINK／SEAL 四種 kernel seal，然後以固定 argv exec sandboxd。磁碟原配置之後修改不會改變執行中的政策；封存配置不能被寫入、截短或取消 seal。
- Connector 從 `/proc` 核對 PID＋start ticks＋host boot ID、binary hash、argv、sealed FD 的權限／內容、實際擁有 API listener 的 socket inode，以及配置與本地政策一致。只看磁碟檔、PID file 或一份自稱成功的 receipt 都不夠。
- Allocation 把政策 digest 和 node incarnation 保存於原私密 journal。Prepare／prompt／approval／pause／resume／recovery／result／事件讀取重新核對；缺政策證據、node 重啟或 mismatch 拒絕繼續。停止、取消及完整停止對帳不依賴通過 egress gate。
- `007_egress.sql` 在 runtime catalog／run 保存 digest；不可變 profile 的 `tool_policy` 也固定 digest。舊 profile 不能在政策變更後提交新 run。已 queued 的 run 保留原 digest，connector 在配置 VM 前拒絕不匹配政策，取消可用「無 allocation intent」證據回收。舊資料不自動補成已驗證政策。
- 固定 terminal launcher 提供 loopback HTTP(S) proxy 環境；guest helper 額外核對只有 lo 與 down 的 sit0。環境變數只是使用便利性：即使工具 unset proxy，也沒有能繞過 host proxy 的 NIC。控制 UID 2001、terminal UID 2000、NoNewPrivs 與憑證隔離契約仍保留。

## DNS、redirect 與政策變更語意

上游 `net.Dialer.Control` 在每次 TCP connect 前检查 **實際已解析的 IP**，拒絕 private、loopback、link-local／metadata、CGNAT、保留位址與已知 IPv4-in-IPv6 特殊形式；沒有第二次按原域名重新解析的 dial。DNS 新連線遭 rebinding 到內網時仍被拒絕。已建立的 public TCP 連線不會因 DNS 變更轉向另一個 IP。

Proxy 自身不 follow redirect；HTTP client 的下一跳必須再經 proxy 的域名／埠規則及解析後 IP guard。HTTPS CONNECT 只授權目的地 TCP 埠：**不檢查 tunnel 內的 HTTP method、path、SNI 或內容**，也不能阻止被允許的遠端服務自己充當轉送器。Allowlist 須限信任的 registry／服務，GET 也不等於沒有外部副作用。

修改 connector 的預期政策不會修改 live proxy，會使新 admission／舊 run 核對失敗。舊 policy 和既有連線繼續受原本邊界約束，直到 VM 完整停止；不能把 mismatch 說成立即撤銷既有流量。變更政策的唯一支援流程是停止新 admission，取消／完成所有 runs（含 paused／approval），確認 claims、原 VMM、VM record、runtime directory、cgroup 都消失，停止 connector／sandboxd，再套用新配置重啟。Launcher 檢查 VM、claims 及 journal 中的完整停止證據；未知 allocation 不猜測成功，journal／fences／generation 原樣保留。

## 配置與升級

1. 先 drain，包括清理或取消舊 queued runs，保存既有 DB／journal／fences。套用 `007_egress.sql`；API／worker／connector 一起更新。
2. 依 [guest isolation](M3-GUEST-ISOLATION.md) 重建本版 terminal launcher，保持 host 產物 0600，更新 file／SHA-256 pin；不原地修補 active guest。
3. 私密 connector 配置新增 `egress_receipt_file`（父目錄 0700、服務帳號所有）及 `egress_policy`。例如 **deny-all**：

   ```json
   {
     "egress_receipt_file": "/private/path/node-receipt.json",
     "egress_policy": {"revision": "node-egress-v1", "allow": []}
   }
   ```

   登錄某一信任服務時，rule 為 `{"host":"registry.example.org","methods":["CONNECT"],"ports":[443]}`。這只是結構範例，不能照抄為可用 registry。80 與 443 使用兩份分開的 rule。
4. Sandboxd 的唯一 pool 保持 `template`／`net:"none"`／`size:"large"`／`warm:0`，加入相同 `egress: {"allow": [...]}`。必須明確設定 `max_claims:4`、`audit_log:true`、loopback listen／advertise／client_advertise、相同 data_dir／operator token。沿用私密 Cocoon 配置與已驗證 cache；不要重新使用不存在的 registry。
5. 在原 KVM delegated service 中改用固定啟動入口（不是直接 `sandboxd -config`）：

   ```bash
   python -m agent_platform.egress_node \
     --config /private/path/connector.json \
     --sandbox-config /private/path/sandboxd.json
   ```

   僅支援已核對的 sandboxd 0.1.12 Linux amd64 binary `d46adf71c028d428560a50a4e7ecfe08ac3c76c20ba0712497d82441d9efd6ca`。啟動器不安裝 binary、不修改 host network／sysctl。服務保持既有 delegated cgroup、RAM／CPU 限制。
6. Connector 與 sandboxd 須使用相同 host UID／GID／可讀 `/proc` 的服務身分；本機舊 session 要兩者一致經 `sg kvm` 啟動，不能放寬 `/proc` 權限。Connector 可在 node 不可用時啟動以提供取消／對帳，但 catalog／新 allocation 會拒絕。Node crash 留有 VM 時不以新 policy 重啟；先由管理員依 ownership 對帳，保留 reservations。
7. 啟動 connector，重新 `register-runtime`，建立綁新 digest 的 profile revision，才開新任務。沒有舊 profile 或 queued run 的無聲 migration。

## 驗收

本次 M0 45 項、平台 129 項、固定上游 DNS 契約兩項與真實 KVM 18 個案例全部通過；測試結束 connector／sandboxd 已停，VM／claims 歸零，私密 journal／fences 保留。

- 一般 CI：政策輸入、Linux kernel seal、真實 `/proc`／socket／PID identity、dead process／binary mismatch、未知 allocation／停止證據、policy mismatch 之 reservation／cancel，以及 queued run／舊 profile 不借用新政策。
- 真實 KVM：proxy **已啟用**；允許 public HTTP／HTTPS、固定 launcher 自動 proxy，拒絕未列主機／埠／方法、metadata／private／loopback／IPv6 literal、直連及 SOCKS。允許名單中的 DNS-to-private 主機得到 IP guard 拒絕。Redirect 先證實源站回 302 與精確 Location，再核對允許下一跳、拒絕未列／metadata／解析成私網的下一跳，避免拿源站自己的 403 當平台證據。
- 政策變更：live pool policy API 回 400，sealed 配置寫入被 kernel 拒絕，active VM 阻擋 drain，預期政策變更拒絕 admission 但仍可完整取消；drain 後改成 deny-all、重新啟動、新 VM 證實原本的 HTTP／CONNECT 授權不再有效。
- 可重現 DNS 契約：讀取 hash 鎖定的上游 `pool/egress.go`，在 temporary package 原樣抽出標準庫 dialer／range 定義，以真實 UDP DNS 將同一域名由 public 改為 private／metadata／IPv6 特殊位址，驗證每次 connect 前的 guard；另驗證 literal special ranges。此項是原始碼契約測試，不冒充重編譯後的 sandboxd 或 KVM 測試。上游 AGPL 原始碼不納入本 repository。
- 同時回歸 guest 控制憑證隔離、輸出 canary、recovery、cancel、approval、pause／resume；每組必須確認 zero VM／claims。

```bash
make platform-check
python scripts/m3-egress-kvm.py --config /private/path/connector.json --output .artifacts/egress-new
# 完整 drain、政策改成 allow:[]、重啟 node 後：
python scripts/m3-egress-kvm.py --config /private/path/connector.json --deny-all --output .artifacts/deny-new
# Go 1.27.x，來源固定在 sandbox tag de42fd50be5cdbfaaa6ddf890081566edb503d3c：
python scripts/egress-upstream.py --source /path/to/sandbox/sandboxd/pool/egress.go \
  --go /path/to/go --output .artifacts/dns-new
```

KVM driver 直接持有 connector journal 時，須停止同 journal 的 HTTP connector；HTTP／DB 回歸則需啟動 connector。公開 `example.com`／`httpbin.org` 與 DNS-to-private 網域僅為 opt-in fixture；不可把它們當 production policy。證據見 [彙整](evidence/m3-egress-2026-09-23.json)。

## 剩餘範圍與上游依據

本切片不提供 project-specific policy、live revocation／active tunnel termination、任意 NIC／CNI 模式、TLS method/path filtering 或通用 exfiltration 防護；不接受節點自訂 NAT64／DNS64 路由（上游無法辨識任意自訂 translation prefix）。信任 host 管理員、固定 runtime 與 guest kernel，不宣告防禦 guest kernel exploit。

下一步 AT-11 應新增專用、authenticated、run-scoped model proxy transport／token／budget reservation／settlement／usage，不能為模型服務直接開啟全節點 private-network override。AT-07 整體仍需與後續 model／artifact 安全整合驗收；M4 artifact XSS／export／backup／GC／production gate 尚未完成。

固定來源：[none-lane proxy 與限制](https://github.com/cocoonstack/sandbox/blob/de42fd50be5cdbfaaa6ddf890081566edb503d3c/docs/egress.md)、[解析後 dial guard](https://github.com/cocoonstack/sandbox/blob/de42fd50be5cdbfaaa6ddf890081566edb503d3c/sandboxd/pool/egress.go)、[forward／CONNECT](https://github.com/cocoonstack/sandbox/blob/de42fd50be5cdbfaaa6ddf890081566edb503d3c/sandboxd/egress/proxy.go)、[pool API 不修改政策](https://github.com/cocoonstack/sandbox/blob/de42fd50be5cdbfaaa6ddf890081566edb503d3c/sandboxd/pool/setpools.go)。
