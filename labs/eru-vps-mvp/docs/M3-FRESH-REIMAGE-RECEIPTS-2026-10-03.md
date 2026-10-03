# 四機 fresh 人工重灌 receipt：本機驗證

## 本輪目標與範圍

接續 [fresh 設計](M3-FRESH-EXECUTOR-DESIGN-2026-10-03.md) 的 hosts-reimaged 輸入契約。本輪實作獨立四台主機（core 加三台 worker）的 manual-console action／receipt 驗證；既有 [單worker receipt](../scripts/reimage_receipt.py) 的 rebuild-node／worker-only限制不改。

輸入綁定已保存 execution、review、scope、G/G+1、原四機observation、逐機host intent與console action digest。每台明列provider resource、OS image、原erase scope、實際volume結果、新machine／boot／Ed25519 OOBfingerprint、console actionref與completion／ownerreview時間。全四台齊全、精確一致且新身份彼此唯一並未沿用任一舊身份才可回報receipts-reviewed。不得將core偽裝成worker plan。

每次console action需在自身created_at之後24小時內完成，completion不晚於ownerreview、不晚於現在；ownerreview距現在最多7天。讀回原preparation時，以其原created_at重驗歷史evidence時效，但仍檢查現在source、input bytes、private root與完整hash linkage；這不延長owner授權或writer fence時效。

## 驗收條件與操作邊界

本機read-only assessment不執行console／SSH／provider，不保存receipt、不改inventory／trust，不reserve／release／commit generation。只有輸入驗證，stage_accepted及executable保持false；operator提供的時間與receipt不是遠端簽章，也不能證明先有durable intent才執行，真實host facts／fencing／stage coordinator仍須分別實作。

須驗證四機positive、跨run／action／scope、missing／duplicate／partial／unknownvolume、舊identity／key重用、時序／時效、重新計算hash的偽造、unsafeprivatepath、pending一致性與零writes。對公開CLI只輸出bounded ID/hash/count/status及false flags。全ERU suite、原workflow與獨立review通過才交付。正式剩餘仍為 12 項，ERU-015仍進行中。

## CLI 與 schema

```bash
python3 scripts/labctl.py inspect-fresh-reimage-receipts \
  --run RUN_ID --sha256 EXECUTION_DIGEST --input private/fresh-reimage-inputs/request.json
```

此入口不取得mutation lock，也不建立輸出檔，因此可在pending期間做唯讀核對；pending若存在，必須精確屬於同一execution、scope、G/G+1、cluster、fence與private backing root，觀測前後一致。回傳`receipts-reviewed`只表示這次本機檔案驗證通過，任何資料缺漏／漂移回傳`blocked`，不選取最新receipt、不補寫或重播。

Request恰有`schema_version: 1`、`binding`、依review順序的四筆`hosts`（各含alias、node、action及receipt refs）。Binding沿用execution context，加`execution_sha256`及原始observation檔案的`observation_sha256`。所有ref均使用private相對path與raw bytes SHA-256。

Action使用`kind: fresh-console-action`，綁相同binding、host_intent ref、舊target、provider_resource_ref、os_image_ref、erase_scope、created_at及唯一provider_console_action_ref；provider_api_used必須false、owner_confirmed必須true。Receipt使用`kind: fresh-console-receipt`，同樣精確綁定上述scope和host intent，另含exact action ref、新replacement身份、逐一volume_results（每筆volume_ref及result: erased）、console_completed_at、owner_reviewed_at、host_key_verified_via: provider-console與Ed25519 fingerprint。Receipt的console actionref必須與action一致；缺一volume、重複、unknown或partial結果皆拒絕。

這些action是operator提供的證據檔，還不是已接上durable-before-dispatch的production coordinator journal。驗證不等於核准重灌、不產生trusted known_hosts，不替代真實replacement host probe。公開摘要只含status、ID、assessment digest、execution digest、host count及固定false flags；完整provider、volume、host與key資訊留在private。

Assessment digest 綁定這次 request 的原始檔案 SHA 與已驗證的 evidence refs，識別的是證據集合。它不保存或簽署一份新的 stage receipt，也不把先前 owner authorization／writer fence 更新為有效。後續 coordinator 必須另外核對當時授權、fence、durable intent 及真實 replacement facts。

## 驗證結果與後續

[實作報告](../.team/reports/T-225.md)、[獨立審查](../.team/reports/T-226.md) 與 [evidence gate](../.team/reports/T-227.md) 保存本輪有界驗收。新模組與 CLI 均先觀察缺入口的 RED，再完成實作。獨立審查無阻擋性發現。

- Root：`PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=tests python3 -m unittest -v test_fresh_reimage_receipts test_fresh_reimage_receipts_cli test_fresh_execution test_reimage_host`，44 tests／2.854 秒通過。
- Independent：`PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=tests python3 -m unittest -v test_fresh_reimage_receipts test_fresh_reimage_receipts_review test_fresh_reimage_receipts_cli test_fresh_execution test_labctl`，138 tests／30.918 秒通過；`test_reimage_host` 另 4 tests／0.003 秒通過。
- Full：`PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v`，614 tests／76.563 秒，零 failures／errors／skips。原 workflow validation、compileall、team contracts、範圍與 whitespace 檢查通過。

下一個本機缺口仍包括 external authorization／writer-fence 證據與 stage admission、重灌後新主機 facts／network-access 驗證、fresh bootstrap／各 stage dispatch、generation CAS／accepted-run seal／barrier completion。之後才是 V01–V04／residue 與三個獨立 live generations；本輪沒有 SSH／provider／VPS 操作，也沒有部署。
