# 設定、驗證與部署關卡

## 不需要雲端帳號的檢查

```sh
cd labs/virtual-office-lab
npm run check
npm test
./bin/office-report grok coding "程式開發" --task code --dry-run
```

核心、CLI 與 Node 測試沒有第三方 npm 依賴，不需要 npm install。Node >=22；CI 使用 repo 標準 Node 24.18.0。核心測試的 storage test double 不等於真實 Durable Object 恢復證據；loopback HTTP 測試也不是 Grok provider 整合。

## 本機 Workers

以下只為**本機**建立可拋棄憑證，不把 token 貼進對話／文件／命令參數。請從 lab 根目錄執行；如果任何檔案已存在，exclusive create 會失敗，不覆蓋既有憑證。失敗可能留下部分新檔，先確認原因，不盲目重跑。

```sh
umask 077
node --input-type=module <<'JS'
import {readFile, writeFile} from 'node:fs/promises';
import {randomBytes, createHash} from 'node:crypto';
const {bots} = JSON.parse(await readFile('roster.json', 'utf8'));
const hashes = {};
for (const {id} of bots) {
  const token = randomBytes(32).toString('base64url');
  await writeFile(`.${id}.token`, token, {flag: 'wx', mode: 0o600});
  hashes[id] = createHash('sha256').update(token).digest('hex');
}
await writeFile('.dev.vars', `AGENT_TOKEN_HASHES='${JSON.stringify(hashes)}'\n`, {flag: 'wx', mode: 0o600});
JS
npx --yes wrangler@4.156.0 dev --local --ip 127.0.0.1 --port 8787
```

另一個終端：

```sh
export OFFICE_URL=http://127.0.0.1:8787
export OFFICE_TOKEN_FILE="$PWD/.grok.token"
./bin/office-report grok thinking "規劃一般工作"
./bin/office-report grok coding "進行程式開發" --task code
curl --fail --silent http://127.0.0.1:8787/state
```

停止／重啟相同 local instance，重讀 /state 應保留 revision、狀態與 lastSeen。不要刪除 `.wrangler` 再聲稱驗證恢復。獨立自動化 smoke：`npx --yes --package=wrangler@4.156.0 -- node tests/workerd-smoke.mjs`，使用 temporary directory 的合成狀態與可拋棄 token；完全不需要 Cloudflare credentials。

CI 將執行實際 local workerd 的 report、衝突及重啟驗證。是否真的通過以該 commit 的 CI 結果為準，不以存在 workflow 推定成功。固定的是 Wrangler 頂層 release，不是完整 transitive dependency lock；後續正式前端／可重現部署里程碑須建立 lockfile 與依賴來源核對。

## 真實 Agent 最小路徑

先只接一個 agent，給它一個無敏感資料的已授權任務。執行端自己呼叫本地／經批准的報告命令，記錄開始→coding 或 browsing→done 的 revision 與 server timestamp；不要記錄 prompt、token、模型帳號或工具輸出。

需要證明的是：真正的 agent 執行端有呼叫 hook，而不是人手 curl、測試腳本或 demo 代替。沒有宿主連線權限時寫「未驗證」，不可用 provider stub 宣稱接通。其他 bot 視窗分別確認權限，遵守各宿主的額度與人工批准政策。

## 公開部署前（本次未授權、未執行）

1. owner 批准公開名冊／活動 metadata、Cloudflare 帳戶與目的地、成本／配額、公開網域與撤回方式。不要索取任何 plaintext token 到聊天裡；使用本機 secret manager 或已授權 connector。
2. 審閱固定摘要、名冊別名、夜間公開風險與 /state 可被匿名讀取的事實。確認 WAF／ingress rate policy；應用 12/min 限流不是未鑑權 flood 防護。
3. 本骨架 `workers_dev=false`、`preview_urls=false`，沒有 routes、公開資產或 deploy workflow。需在獨立批准變更中設定公開入口；不要把 repo root 當 assets directory。
4. 本機與正式配置、token、OFFICE_ID 完全分開；正式用新 namespace ID（例如 `public-office-v1`），先確認所有 agent lastSeen=null、revision=0。demo 使用另一個 worker／namespace 與 OFFICE_MODE=demo。
5. 經批准後用 `wrangler secret put AGENT_TOKEN_HASHES` 注入各 agent digest map，原始 token 只交給對應執行端；禁止多人共用。只設 hash 而不知道原始 token 不可偽造上報。
6. 執行部署後驗證：匿名 GET 成功；匿名 POST 401；跨 agent token 401；摘要欄位 422；大 body 413；限流429；重送不增加版本；舊版本409；公開 JSON／日誌／static assets／source map 不含秘密。
7. 完成批准範圍內的重啟與復原演練；既有資料備份採供應商可用的受控恢復能力，先在隔離 namespace 演練，不對正式資料做 deleteAll。必要時關閉公開路由，保留證據；回復程式碼不能回復已撤銷的 token。
8. 明確記錄 endpoint、版本、驗證來源與仍未跑的項目；私密 endpoint／帳戶只留私人設定，不寫進這個公開 repo。沒有全部 AC／必要 CI／審查及合併，不發 usable tag。

## 用量與操作邊界

不用 paid AI API、WebSocket 常駐、Cron、DO alarms 或背景輪詢 agent CLI。前端規格為可見頁面 15 秒 poll；單一連續訪客理論上約 5,760 次 GET／日，這是流量算式，不是免費額度或帳單承諾。GET 不寫 DB；state 最多 16 agents，每 agent 保留 32 筆去重 metadata。部署前查當時方案、配額與帳單保護；本次沒有建立任何付費資源。

無 admin reset HTTP 介面。要清除測試污染優先換到新的正式 namespace，而不是向公開服務提供刪除權限。若疑似 token 外洩，撤銷該 agent digest、生成新 token、更新該執行端，再驗證舊 token 401。不要把撤銷動作當成有權刪除資料。
