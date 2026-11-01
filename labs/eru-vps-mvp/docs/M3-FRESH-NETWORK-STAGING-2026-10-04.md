# Fresh network file staging：durable intent、單次 dispatch 與唯讀恢復

## 目標與邊界

接續 [固定設定計畫](M3-FRESH-NETWORK-ACCESS-PLAN-2026-10-04.md) 及 [executor設計](M3-FRESH-EXECUTOR-DESIGN-2026-10-03.md)，新增具體四host staging協調器。每host只處理計畫中兩份固定檔案，依core→worker順序；不啟用nft、effective authorized_keys、service或更新controller trust。這是network stage的一個子步驟，不是stage acceptance。沒有production SSH adapter或execute CLI（只有本機inspect CLI），本輪只用synthetic filesystem與fake adapter證明協調器契約；不是重做既有十二stage simulation。

一般API呼叫必須提供可信adapter，實際transport/host-side atomic no-clobber write及遠端action provenance尚待實作與審查。不能把注入adapter視為安全邊界，也不能把其自報觀測當獨立認證。沒有真private／SSH／VPS/provider操作、runtime dependency或generic ClusterLock bypass。原本pending必須保持exact且一般mutation仍被阻擋。

## API與授權

- `stage_network_files(project, plan_id, expected_sha, authorization_file, authorization_sha, host_index, adapter, *, now=None, source_state=None)`。
- `inspect_network_staging(project, run_id, host_index, expected_intent_sha, *, now=None, source_state=None)`：完全本機只讀，無adapter、無writes。
- `reconcile_network_files(project, run_id, host_index, expected_intent_sha, observer, *, now=None, source_state=None)`：observer僅observe，不呼叫stage；精確action provenance及postcondition才可追加單一recovery receipt，不能靠檔案存在推定完成。

host_index只接受type int的0..3，run固定為原execution ID，不由caller另選action ID。輸出僅status/run id/host_index/intent_sha256/receipt_sha256/counts/dispatch_attempted與固定false stage_accepted/generation_changed/external_fence_verified，沒有private payload或錯誤原文；不宣稱remote_mutation_performed=false，因adapter呼叫結果可能不確定。非法公開ID/SHA可raise。

Authorization為raw-hash-bound private JSON，exact欄位：schema_version:1、operation:fresh-network-file-staging-authorization、plan_id、plan_sha256、execution_sha256、pending_sha256、scope:stage-network-files-only、owner_confirmed:true、authorized_at、expires_at。必須與current plan/pending一致，timezone-aware、authorized_at<=now<=expires_at，expires_at-authorized_at最多15分鐘。這是外部授權聲明的嚴格binding，不是密碼學身分驗證。原network plan/admission/fence/receipt/source/private-root的時效與驗證仍須每次重跑，不能刷新歷史preparation或信任cached summary。

## 固定adapter contract

Coordinator只把重新導出的固定host payload交給adapter；不得傳入caller提供的任意path/command。`adapter.observe(action)`先讀取before state；`adapter.stage(action, intent_sha256)`最多一次；回值不作完成證據，必須再observe。Recovery傳入只有observe的observer。前置observe不能消除遠端TOCTOU；未來stage adapter本身必須在寫入前重驗host identity、實體目錄安全及兩path absence，逐檔原子no-clobber。部分完成時保留原bytes，不覆寫、回滾或cleanup來修飾結果。

Action exact結構由implementation定義並記入immutable intent，至少綁operation、plan/run/execution/pending、host_index、該host alias/node/IP/machine/boot/host-key digest、兩份固定file payload及原始plan digest。觀測exact結構由implementation定義並於測試明列：observed_at、同一host identity、`/etc/eru`目錄為root-owned 0700實體directory、兩檔固定順序。Before要求兩檔均absent，不接受matching-existing來自動採納；after要求regular/root-owned/0600/nlink1、exact sha256及action intent digest provenance。觀測最多15分鐘且非future；final clock再核對。觀測不到、partial、foreign identity或缺action provenance都不重播。

## Durable journal與執行順序

固定私有區`private/operations/fresh-rebuild/network-staging/RUN_ID/host-N/`。每execution/host只有一個slot，不能改plan ID或action ID繞過既有claim。host0 predecessor為execution digest；hostN必須核對所有較早host完整且passed的receipt chain，以及同一plan digest；缺少、不同plan、pending變更或未知entries一律blocked。

1. 使用PrivateFiles及descriptor pins安全載入完整current plan、當次authorization和所有predecessor receipts，保留raw bytes及publication identities。
2. 先observe確認exact before state，再no-clobber mkdir claim；同slot只有一winner。Claim即不可重用；即使intent尚未發布也不能認定沒dispatch。
3. immutable intent保存exact action、authorization rawref、before observation、predecessor digest與created_at；fsync檔案及父目錄，讀回核對publisher原raw SHA。發布後完整重驗current bindings、private root/pending/publications及final time，才允許一次stage呼叫。失敗時保留claim，零dispatch。
4. stage回應遺失／exception後返回uncertain，不再呼叫stage；原intent保留。成功回應後observe並驗證exact postcondition/provenance，再發布immutable receipt、fsync、讀回raw SHA及末端重驗。late publication failure不回成功，保留failure marker，不自動cleanup/reuse。
5. 重複stage只讀分類現有slot（staged/uncertain/blocked），dispatch count不增加。不同plan不能借用slot。Inspect不寫入或呼叫adapter。Reconcile只observe；只有完整exact action evidence才發布recovery receipt，單一winner，receipt之後可作後續host的predecessor；不重新dispatch、overwrite、啟用設定或更新pending。

Unknown/temporary/failure entries、壞JSON/hash、symlink/hardlink、parent替換、rawref/source/root/pending漂移一律fail closed。歷史receipt不更新時間；current plan/auth逾期時停止後续與reconcile，不自行延長授權。這個保守限制的續作授權流程仍待後續設計。

## 驗收

RED→GREEN：回應遺失後第二次stage零重播；intent未durable或末端drift/expiry零dispatch；same-slot併發single-winner；換plan不能重播；四host順序與完整predecessor binding；before-existing/path/mode/identity拒絕；after部分／缺provenance拒絕；只讀reconcile完整/partial/unknown及late receipt failure；rehashed/corrupt records、raw whitespace mutation、root/directory/pending/source races、offline zero-writes、public redaction。獨立review、focused/adjacent/full native suite、原CI及evidence gate必須通過。

正式剩餘12不變。後續仍須真正固定SSH adapter的transport/helper/ownership/atomic staging驗證、network activation與實機observations、fresh bootstrap、generation commit/seal及三次live generation。不得將本輪fake adapter成功當VPS或整體完成。

## 凍結的record/observation schema

Action精確欄位為schema_version:1、operation:fresh-network-file-staging、plan_id、plan_sha256、run_id、execution_sha256、pending_sha256、host_index、host（完整rendered host含兩files）。Intent精確為schema_version:1、operation:fresh-network-file-staging-intent、action、authorization rawref、before、predecessor_sha256、created_at、private_identity；envelope為{intent,sha256}。

Observation精確為observed_at、host（alias/node/ip/machine_id/boot_id/host_key_sha256）、directory（path:/etc/eru、kind:directory、uid:0、gid:0、mode:0700）、files。Before file只含path/kind:absent；after file精確含path/kind:regular/uid:0/gid:0/mode:0600/nlink:1/sha256/intent_sha256。字串mode不得以數字替代；numeric欄位拒絕bool。Receipt精確為schema_version:1、operation:fresh-network-file-staging-receipt、intent_sha256、observation、created_at、recovered:bool；envelope為{receipt,sha256}。

Chronology要求before.observed_at<=intent.created_at<=after.observed_at<=receipt.created_at<=current；所有觀測亦受15分鐘時效及非future限制。傳入adapter的action獨立copy，避免adapter原地修改成為新的authoritative payload。

```sh
python3 scripts/labctl.py inspect-fresh-network-staging \
  --run RUN --host-index 0 --sha256 INTENT_SHA
```

此CLI完全只讀且不進Operator／ClusterLock。沒有stage或reconcile CLI，因可信production transport與遠端原子發布尚未交付。

## 審查修正與保守限制

Receipt發布使用暫存`.receipt-claim`區分owner與競爭者，只有實際發布owner的失敗會poison。取得claim後仍重查receipt是否已被較早caller完成；late loser撤回自己的暫存claim且不污染winner。完成slot仍只有intent.json與receipt.json；未完成claim／marker一律阻擋，不自動清除。Run目錄identity及host-0..N連續prefix同樣pin，拒絕未知entry或holes。

獨立review重現末端before observation過期與late receipt loser競態，root另重現最後raw evidence讀取後pending漂移仍dispatch。修正將current plan、所有predecessor與授權的純time checks放在最後I/O之後，且末端再核對pending。三個blocker與CLI共13 tests／8.111秒通過。這仍是連續重驗，不是跨檔案／遠端的原子snapshot；需要穩定的叢集外journal及真正外部writer fence。

Adapter第一次observe的未知Exception也回publicsafe blocked，不輸出原始例外；後續stage或observe結果不明時保留intent且不重播。真實adapter仍須另實作有界transport、host-side身分／ownership／absence比較與原子no-clobber；不能從fake ledger推論這些已成立。

## 最終驗證與後續入口

T-237實作與T-238獨立審查接受；T-239記錄整體PARTIAL。worker66 tests／161.790秒、獨立96 tests／217.408秒、root阻擋回歸與CLI13 tests／8.111秒、完整751 tests／281.252秒全部通過；compileall、原CI gate及team/scope/privacy/whitespace檢查通過。沒有未解決本輪finding。

下一個本機入口是固定且有界的SSH staging adapter／host-side compare-and-stage：核對OOB trust、exact incarnation、安全目錄、兩path absence、原子no-clobber及durable action provenance，先以fake transport／contract tests交付。之後才接network activation與觀測、fresh bootstrap／generation commit/seal和live acceptance。expired authorization如何明確續作仍需另行契約，不能暗中重播或延長原授權。
