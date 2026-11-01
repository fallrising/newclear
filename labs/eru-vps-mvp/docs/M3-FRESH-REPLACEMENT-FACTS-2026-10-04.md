# Fresh replacement hosts：裸 OS 唯讀 facts

## 目標與驗收範圍

接續 [四機人工 receipt](M3-FRESH-REIMAGE-RECEIPTS-2026-10-03.md)，實作 core 與三台 worker 的專用新主機觀測。固定 probe 核對 machine ID、boot ID、OS PRETTY_NAME、Ed25519 host public key、amd64 architecture，以及明列 ERU／etcd 路徑是否存在；主機身份在 probe 前後須一致。它不要求 Docker、containerd、ERU 或 Tailscale command 已安裝。

Request 綁定已通過的 receipt assessment 與原始 receipt request ref，明列精確四個 alias／node／IPv4／canonical Ed25519 public key。CLI 另要求 request 原始 bytes SHA；public key 必須先符合 receipt 的 provider-console OOB fingerprint，才可開始 SSH。不得自動掃描金鑰、更新原 trust 或把舊 inventory IP 當成重灌後新 endpoint。

凍結 API：collect_replacement_facts(project,run_id,execution_sha,input_file,input_sha,observation_id,*,reader=None,now=None,source_state=None)；inspect_replacement_facts(project,observation_id,expected_sha,*,now=None,source_state=None)。collect 保存新 immutable private observation；inspect 只讀並重導出 facts。兩者公開摘要的 stage_accepted／executable／remote_mutation_performed／generation_changed 均 false。

## 安全與失敗契約

沿用 strict SSH transport 的固定使用者／port、禁用 user config／proxy／forwarding、memfd pinned known_hosts 與即時輸出／時間上限。只呼叫固定唯讀 Python script；失敗或未知輸出不推定為空狀態。所有 malformed／duplicate／oversized JSON、identity drift、receipt/input/source/root 漂移均拒絕。

觀測資料使用獨立 private 區，先不可覆寫地保留 observation ID，失敗保留 claim 且盡力寫 stop marker。即使 pending 存在，只有 exact same execution 的穩定 pending 可收集唯讀 facts；不改 mutation lock、不解除 reservation、不授予後續執行權。各次 probe 前後、發布前後都重新核對 receipt 和 pending。離線 inspect 不連遠端、不寫檔，重新核對 raw refs、fixed-script digest、facts 與時效。有效 facts 最多15分鐘，整輪最多360秒。

這只證明受限採樣內容與 receipt 一致。已知路徑缺失不能證明所有 data roots／mounts／runtime 都乾淨，也不代表 network-access-ready、外部 writer fence、bootstrap 或 hosts-reimaged stage 已 accepted。真實 facts 檢查須另有操作授權；本輪測試只有 synthetic files、fake transport 及本機 subprocess，沒有 VPS／provider／真實 private 操作。

## 必要測試

先 RED 再實作：四機包含 core 的正向流程、無 runtime command、OOB key／endpoint／receipt binding、舊身份與採樣期間漂移、OS／arch／known-marker拒絕、malformed／partial／timeout／oversize、同ID不可重用、late fsync／directory替換、foreign／changed pending、trusted private-root symlink、重算hash後的證據造假、offline零writes／零SSH、CLI redaction。獨立審查與完整原生suite／workflow gate通過才交付；ERU-015仍進行中，正式剩餘12項。

## 輸入與 CLI

request 精確包含 `schema_version: 1`、`run_id`、`execution_sha256`、`receipt_request: {path, sha256}`、`receipt_assessment_sha256` 與依既有固定順序排列的四筆 `hosts`。每筆 host 精確包含 `alias`、`node`、`ip`、`public_key`。IPv4 必須 canonical 且四機不重複；它只是明確的連線目標，不是私網或連通性證明。

```sh
python3 scripts/labctl.py collect-fresh-replacement-facts \
  --run RUN --sha256 EXECUTION_SHA \
  --input private/replacement-request.json --input-sha256 REQUEST_RAW_SHA \
  --observation-id OBSERVATION
python3 scripts/labctl.py inspect-fresh-replacement-facts \
  --observation OBSERVATION --sha256 OBSERVATION_SHA
```

第一個命令會使用 SSH，需符合當次操作授權；以上只記錄介面，本輪沒有執行真實連線。第二個命令完全離線。公開結果只含狀態、ID、digest、host count 及四個 false flags；不輸出 IP、public key、private path 或採樣內容。`observed` 表示本契約通過，`blocked` 表示不得使用此紀錄推進；兩者都不接受 fresh stage。

紀錄位於 `private/operations/fresh-rebuild/replacement-observations/OBSERVATION/observation.json`。Envelope 的 `sha256` 是 canonical observation record digest；request ref 的 SHA 則綁原始檔案 bytes。輸出雜湊不能證明不受信任 controller 的誠實性，仍需可信 controller、OOB 金鑰來源與穩定 backing root。

## 固定 probe 與紀錄語意

固定 marker 為 `/etc/eru`、`/etc/etcd`、`/var/lib/etcd-eru-mvp`、`/usr/local/bin/eru-core`、`/usr/local/bin/eru-agent`，以及 `/etc/systemd/system/`、`/lib/systemd/system/`、`/usr/lib/systemd/system/` 下的 `eru-core.service`、`eru-agent.service`、`eru-etcd.service`、`eru-mvp-firewall.service`、`eru-containerd-proxy.service`、`eru-containerd-proxy.socket`。broken symlink 算存在，permission／I/O error 拒絕，不將未知結果推定為缺失。

每個 identity file 以 nonblocking、最多 64 KiB 的 regular-file 讀取並核對前後 inode／timestamps；只有 `/etc/os-release` 允許固定路徑的 symlink，解析不經 shell。四機輸出保存在 `captures[].outputs`，是已拒絕 duplicate keys／非有限數值的 decoded JSON，不是原始 stdout bytes。每筆包含固定 script SHA 與明確 endpoint/key；離線檢查會重導出所有身份、OS、架構、marker 及時效條件。

獨立審查以兩個 deterministic-clock regression 重現慢 publication／末端 context 造成的過期回傳；已在最後 context 完成後重新核對 observation 時效。晚期寫入失敗會保留 claim 與 failure marker；即使 `observation.json` 已存在，也不能離線接受或重用 ID。此保護不是跨主機原子快照或底層磁碟斷電證明。

## 驗證結果

Root focused 43 tests（10.071秒）、worker指定67（10.077秒）、独立審查86（13.206秒）與完整 `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v` 643 tests（78.847秒）全部通過，沒有failure/error/skip。原 component workflow 的AST／JSON／relative-link／private-exclusion／whitespace驗證、compileall及team task/report驗證通過。測試組彼此重疊，不相加。兩個時效RED已修復；完整scope仍為PARTIAL，真實VPS與fresh generation acceptance未執行。
