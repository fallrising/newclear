# 閱讀快記私人試用操作手冊

這是 #473 新里程碑「閱讀快記私人試用準備」，不是原規格階段 3。階段 0–2 的 RC 與聊天室 W0–W7 保留。此文件的命令是操作入口；實際執行結果見[交付報告](../tasks/473-private-trial/report.md)。**本地合成驗證不等於正式私人環境驗收**；尚未接正式內容、憑證、排程或部署。

## 準備本地設定

使用 Linux、Node **24.18.0**、Git，以及此版本已按既有 lockfile 安裝的 worker/web 依賴。所有 repository 開發 build/test 經共同 launcher；正式 operator 的單次 exporter 不需要開發 launcher。

複製 [trial.example.json](ops/trial.example.json) 至 source checkout **外**的私有目錄，設為 `0600`，父目錄與 `releaseRoot` 設為 `0700`。範例不能直接使用，沒有預設內容 repo 或合成 fallback。欄位：

| 欄位 | owner 填入內容 |
| --- | --- |
| appDir | 已核對 Kith commit、已安裝依賴的 `products/kith` 絕對路徑 |
| contentRepo / contentBranch / contentRemote | 乾淨的專用內容 checkout、所在 branch、精確 origin fetch/push URL |
| contentCommit / registry | 明確 40 字元小寫 SHA、該 commit 內的 registry 相對路徑；至少一篇文章 |
| exportRepo / exportBranch / exportRemote | **另一個**專用匯出 checkout、既有遠端 branch、精確 origin fetch/push URL；可與內容 checkout 共用 private remote |
| baseUrl / tokenFile | HTTPS origin、dedicated export token 的 owner-only 檔案路徑（首次部署的空白占位見下文）；token 不放 JSON／環境變數／argv |
| releaseRoot | checkout 外的私有版本目錄；保留完整版本與 `current` 指標 |

內容 ID 明確且穩定，檔名變更不改 ID。registry／正文讀取固定 commit 的 Git blobs，不執行內容 repo 程式。內容與匯出 checkout 均不得有 `.gitattributes`、無關修改／未推送工作，非空 Git info/attributes 亦拒絕；Git transport 與同 Unix 使用者仍可信任。內容 checkout 與匯出 checkout 分開，避免一次 export 改變準備用的 HEAD。Git URL 不得內嵌 token/password；採 owner 既有 Git 憑證機制。

首次接線若尚未部署支援 token 簽發的版本，owner 可在私有秘密目錄**新建空白、0600 的 tokenFile 占位檔**，供純檔案權限檢查；不要覆蓋既有憑證。Preflight不讀取token內容，因此此結果只代表metadata符合，**不是有效憑證或正式接線成功**。空白檔不允許執行export／排程。先依下方順序準備完整產物、由owner部署，登入operator簽發真正token並私下替換該檔，再重跑preflight與單次export，才可驗收匯出或啟用timer。這是待owner執行的bootstrap計畫，本次沒有建立正式占位或模擬簽發。

## 離線檢查與完整版本準備

以下三個入口不會 fetch、push、呼叫 Worker、安裝套件或部署。`prepare` 執行可信 app checkout 的 web build；不要對不可信程式 checkout 執行。

```sh
node reading/trial.ts preflight --config /private/config/trial.json
node reading/trial.ts prepare --config /private/config/trial.json
node reading/trial.ts verify --config /private/config/trial.json
```

Preflight 檢查必要路徑、Node/Git、checkout/branch、origin 一致性、固定 commit 與 registry、憑證檔 owner／權限。Partial/promisor clone 會被拒絕，以免讀Git物件時隱式fetch；使用完整本地clone。這只能觀察本地狀態與 cached remote ref，**不能證明遠端連線、Git 寫入權、token 有效或未撤銷**。失敗只回報有限檢查類別，不印內容、URL、token、完整設定或子程序 stderr。

Prepare 先在 `releaseRoot/releases/<id>/assets` 建立 web，再使用原有 `buildReading` 加入 `_reading/current.json`。驗證非空完整 bundle、來源 commit、index 與 asset 檔案，保存 manifest 中全部 assets 的 SHA-256，最後原子替換 `releaseRoot/current` symlink。`current` 指向包含 manifest 與 assets 的完整 release；**可部署的 assets 路徑是 `current/assets`，不是 web/dist**。Manifest 是損毀偵測，不是防篡改簽章；同使用者可同時改檔與 hash，操作者須保護目錄。

任何 web build、registry、正文或完整性檢查失敗，命令非零退出且不切換 current；保留失敗候選供診斷，無自動清理。切換前舊版全程保留。程序錯誤與突然斷電不同：候選檔案在切換前flush；主機突然斷電後current可能指向前版或新版，兩版均保留，恢復後必須重新verify；這不是磁碟硬體耐久保證。不要以單獨 `npm run web:build` 或 public CI 的合成 bundle 做私人發布；它會清空傳統 web/dist，而且 CI 只證明合成內容建置。正式發布前必須 verify，並凍結該 release 的實際路徑，在部署期間禁止平行 prepare／修改產物。

## 明確會連外的操作

以下由 owner 另行執行；本里程碑沒有對正式系統執行：

1. Git clone/fetch/ls-remote 及憑證測試會連指定 Git remote。先核對 origin 與 branch，再 fetch，以完整 commit 更新設定；不自動 pull/reset。離線 preflight 不會幫忙做這一步。
2. 在登入 operator 的 Kith 私人頁面建立 export token，直接寫入私有 `0600` 檔。明文僅顯示一次；不要貼 issue/PR、截圖、CI 或 shell history。
3. 手動執行一次既有 exporter：

   ```sh
   node reading/export.ts --repo /private/export --branch main --url https://kith.example --token-file /private/secrets/export-token
   ```

   這會呼叫 export/ACK HTTP、Git fetch/push；它不是 dry-run。記錄 exit、commit、數量即可。失敗不代表沒寫入；保留 journal，再執行同一命令恢復。D1 是 captures/notes 權威；Git 是 AI 正文權威。只在遠端祖先與 snapshot bytes 確認後 ACK，notes revision CAS 保留。

## Linux 定期執行範本

[service](ops/kith-reading-export.service)、[timer](ops/kith-reading-export.timer)、[環境範例](ops/export.env.example) 是 **systemd user units 範本，沒有安裝或啟用**。Owner 核對主機 Node/Git 絕對路徑、app 工作目錄與環境檔路徑後，才可複製到自己的 user unit 目錄；環境檔只有路徑與 endpoint，沒有 token 值。不要使用另一個 network namespace：exporter 的 Linux abstract socket 單例鎖在同一 namespace 才能序列化。

範本為 `Type=oneshot`，15 分鐘總 timeout，結束後約 5 分鐘再跑；服務仍在跑時 timer 不會另開同名實例。沒有 `Restart=always`；這不是每筆資料恰好 5 分鐘送達的 SLA，也不會補跑每個錯過的週期。下次單次全量有界對帳可補未匯出記錄；100 頁上限會明確失敗，不能把截斷當完成。計時語意見 [systemd.timer](https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html)。

只有 owner 完成單次正式驗證後才考慮這些命令：

```sh
systemd-analyze --user verify ~/.config/systemd/user/kith-reading-export.service ~/.config/systemd/user/kith-reading-export.timer
systemctl --user daemon-reload
systemctl --user start kith-reading-export.service
systemctl --user status kith-reading-export.service
journalctl --user -u kith-reading-export.service --since today
systemctl --user enable --now kith-reading-export.timer
systemctl --user list-timers kith-reading-export.timer
```

`journalctl` 與 `systemctl show ... -p Result -p ExecMainStatus` 檢查最近失敗；再看 D1 收件匣 pending 與最後成功 remote commit。沒有自動告警服務，owner 必須指定檢查頻率與責任人。不要只看 timer active：其子服務可能失敗。user manager 登出後是否常駐取決於主機政策；linger 屬另行主機操作，本次不設定。

**停止：** `systemctl --user disable --now kith-reading-export.timer` 後，`systemctl --user stop kith-reading-export.service`。只停 timer 不會取消已開始的 pass；停止期間手機仍直接保存 D1。停止可能發生在 push 已成功、ACK 未回應之間，保留 journal。

**恢復：** 先讀 failure log、核對設定/remote、保護 checkout 與 journal，再手動 start service；確認 exit0、Git remote 與 D1 狀態後 enable timer。不可刪 journal、偷鎖、reset/clean 或 force push 來解除錯誤。

**撤銷：** 停 timer/service，operator 在 UI 撤銷該 token；再用舊 token 的一次受限 export 請求確認 401，確認 UI仍能保存。需要恢復時另簽新 token，私有方式替換檔案後手動驗證。檔案刪除不是遠端撤銷；Git transport 憑證的撤銷另由 remote owner 負責。已匯出私人內容仍留在 Git 歷史，撤 token 不會刪除它。

**衝突：** 保留 common Git dir 中 `kith-reading-export/journal.json` 與 pending commit；在另一 checkout 正常整合遠端分歧，保留該 snapshot commit 的祖先關係與精確匯出檔案，再正常 push。回原 checkout 重跑，由 exporter 做遠端確認與 ACK。若解法改變 snapshot bytes，停止並按 D1 權威核對；不可手改 journal 或從 Git 回灌 D1。完整故障語意見[既有 exporter 手冊](README.md#interruption-and-conflict-recovery)。

## 正式接線、備份與回復順序

下列是待 owner 執行的操作計畫，**不是本次執行紀錄**。Wrangler 使用專案已鎖定版本；先用其本地 `--help` 確認命令，勿用會自動安裝新版的裸 `npx`。

1. 私下確認 Kith app commit、內容 remote/branch/commit/registry、Worker/domain/D1/KV/R2/DO bindings 與 operator。建立 source checkout 外的正式 Wrangler config；不要沿用 repository 歷史 account/resource ID。保持 `assets.run_worker_first=true`、`binding=ASSETS` 與 SPA設定，所有模型／paid flags off；不要新增公開資產 bypass。不要把真實配置提交公開 repo。
2. 暫停 exporter；保留現有 app version/deployment ID、完整 assets release、設定非秘密摘要、已套 migrations 清單。將 D1 完整資料庫以 `node_modules/.bin/wrangler d1 export <DB> --remote --output /private/backup/d1.sql --config /private/config/wrangler.toml` 保存到 `0700` 目錄（輸出含秘密與私人資料，檔案 `0600`），另記 Time Travel bookmark（若可用）。輸出與重建的限制見 [D1 CLI](https://developers.cloudflare.com/workers/wrangler/commands/d1/)。
3. 備份兩個 Git checkout（含工作檔、`.git`、未推送 snapshot與journal）、remote 歷史、registry與設定；另行受保護地備份憑證，與公開報告分離。Git bundle 只含 reachable committed history，不能替代 working tree／journal備份。備份檔不可進 CI artifact或共享日誌。保留 checksum與來源SHA，先在隔離目錄驗證能還原；不要覆寫原 checkout做演練。
4. 核對正式 migration 已套版本。階段1/2包含0007、0008，僅對缺少項目審閱後另行套用；本次不執行 `--remote` migration，不自動 bootstrap/重設既有operator。部署程式回復不會回復D1 schema或資料。
5. Fetch內容後更新完整SHA，執行 offline preflight → prepare → verify；保存所選完整release與其manifest，凍結實際release路徑。再以私有config與該assets路徑做本地 `wrangler deploy --dry-run --outdir /private/check/worker --assets /private/releases/releases/ID/assets --config /private/config/wrangler.toml` 檢查；dry-run不是正式授權、帳號／路由或遠端binding驗收。
6. Owner 核對備份、正式配置與完整產物後，才可手動 `wrangler deploy --assets /private/releases/releases/ID/assets --config /private/config/wrangler.toml`。這會上傳並生效；本里程碑沒有執行。記錄回傳version/deployment ID與UTC時間，驗證登入後commit一致、未登入直接資產GET/HEAD及編碼路徑拒絕，再做下方手機清單。勿把manifest檔放進assets公開區。Cloudflare version包含程式、assets與bindings；見[版本與部署](https://developers.cloudflare.com/workers/versions-and-deployments/)。
7. 建立／核對正式export token、手動export並核對remote commit與D1 ACK。只有成功後owner才啟用timer；更新內容須重新固定commit準備並發布，沒有新增自動部署CI或排程。

**建置故障：** 不做部署，current與既有線上版本不變；修來源後新建候選。**程式／內容發布後故障：** 停止後續發布與export，保留失敗版本與D1新增資料，選先前已驗證完整release重新verify；owner可依保存的version ID執行 `wrangler rollback <VERSION_ID> --config /private/config/wrangler.toml` 並回讀版本與保護路由。此回復不逆轉D1寫入，bindings改動也可能阻擋rollback，見[官方限制](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)。若需重部署舊版，必須是舊程式＋同版完整assets，不可只換bundle或用空web/dist。

**D1損毀／migration失誤：** 停止所有寫入者（含手機入口）及export，先保全目前D1與未匯出資料。先在隔離資料庫還原backup/Time Travel，驗證captures原文、notes revision、token撤銷與聊天室資料，再由owner批准切回。不要以Git匯出覆寫D1；這會遺失未ACK資料與其他表。還原舊D1可能使撤銷狀態倒退，恢復入口前重新撤銷舊token／sessions並核對權限。若切換到新D1，需一起核對DO recovery與bindings，不能只改DB名稱。

## 手機私人試用驗收（owner，本次未執行）

記錄日期、app SHA、內容SHA、部署version、瀏覽器／OS，使用私下保存的資料；公開只記pass/fail與匿名缺口。

- 未登入時 API及 `/_reading/current.json`（GET/HEAD/編碼路徑）拒絕；operator登入才能讀，不同身分不能碰快記／notes／token管理。
- 真手機窄螢幕閱讀，AI正文／人類區分清楚，commit符合選定內容；內部連結正確，危險HTML／URL不執行。
- 保存快記後重整仍在；模擬遺失回應後同client_key不重複；斷網只顯示本機草稿，不冒充已保存或離線queue。
- 同篇notes修改、兩分頁revision衝突保留草稿；切換文章與正文更新不覆蓋正在編輯的人類補充。
- 停export仍能快記／notes；恢復後remote出現精確原文，D1顯示匯出，重跑無重複commit；撤token後失敗可見且無ACK。
- 更新同ID正文commit並發布，頁面不手動reload也更新正文與commit、人類補充仍在。製造無效registry／web build失敗，確認不發布、前版仍可讀且快記可保存。
- 用隔離備份做一次回復演練；明確確認回復不丟失新D1資料。連續私人試用記錄卡點，再由owner決定是否接受，不代答真人結果。

## Owner 最少待提供資料

透過私有管道提供：內容repo與既有branch、固定commit／registry；要使用的Kith版本及正式HTTPS origin與Cloudflare資源對應；專用Linux操作帳號可用的Node/Git/app/checkout/release/backup路徑；既有Git transport權限與operator可建立export token的安排（不需把秘密值交到公開對話）；備份保存位置與誰執行部署／排程／手機驗收。Owner尚未提供前，以上接線均保持未驗證；本地合成測試不填補這些結果。
