# Reviewed dashboard rollout

Owner明確批准更新原Lab看板，保留D1、Access、secrets與原授權期限、不新增付費方案。本輪只部署PR697經T824接受的三份資產；Worker modules逐byte未變，不重新生成憑證、延長grant、修改應用資料或啟用排程。

| AC | 驗收 | 現況 |
| --- | --- | --- |
| DR-01 | 三份資產與已審查commit/hash相符；Worker modules與既有版本相同，保留DB、secret bindings及Access policy | 自動核對通過 |
| DR-02 | 保存前版及回退request；先回讀前態，再上傳資產及版本；核對routing仍worker-first、workers.dev／preview／Cron關閉 | 新版本100%；回退僅準備，未演練 |
| DR-03 | 匿名請求回傳302，現有機器bootstrap成功，原grant期限／排程／命令保持；不以service token代替human驗收 | 五處302、機器兩處200；資料相等 |
| DR-04 | Owner以一般瀏覽器經既有Access登入，看板提交一次固定唯讀檢查、看到結果並下載成果；分開owner觀察與D1／journal對帳 | 真人流程待驗；實體手機依owner指示改選測 |

狀態：in_progress。新版已於2026-10-28T09:51:04Z發布並完成自動回讀；完整AC06–08／mainline仍pending。沒有升級付費方案，未獨立驗證實際帳單為零。

## 來源與部署證據

以下部署事實及hash比較均由主導檢視私人原始receipts、source與回讀結果；T825僅獨立評估去識別材料的內部一致性及表述，不曾存取Cloudflare、私人receipts或自行重算source hash。

Reviewed source為PR697的`6915230b16b9e46477eba7fa1b39816065b820a0`。三份資產逐一核對git blob及SHA-256；Worker三個module與原始發布內容逐byte相等。

| 資產 | SHA-256 |
| --- | --- |
| index.html | `2eafea61c384594341c0288d2a9387be8b4190ff8a2b8f708063040228cf2ecb` |
| styles.css | `873fbfe381ae8d30c3df23f7fc14e7067cf7ff5c4cae9f487d446c3a13ac71e1` |
| dashboard.mjs | `df96b8d6d6b55deb679ce681f19e3c2e3245af48b512eaafe1327c41cd9a0059` |

私人receipts保存最初baseline、owner明確批准後的重新核對、前版100%回退request、manifest、三個asset bucket上傳及一次Worker發布。發布前再讀deployment／settings確認沒有漂移；更新保留`keep_bindings: ["secret_text"]`，不在新request重新寫入secret值。

主導回讀新version number2佔100%；Worker version API的resources投影、settings、subdomain、Cron、domain records、Access app及policies與前態相等。resources投影包含script的etag／handlers／named_handlers／last_deployed_from、script_runtime的assets routing／compatibility_date／usage_model，以及binding metadata；secret_text僅含名稱及類型，不含secret值，不能據此宣稱逐值相等。該投影也不含三份資產內容或manifest hash；新資產由已核對的source／manifest／upload request及接受回覆支持，不能用resources相等代替資產驗證。D1 grants／commands／schedules／firings內容相等，原3筆命令active0、firings0，resident runner active。這些是當次快照，不宣稱未來不會變動。

原機器profile執行唯讀`live_probe.py`：`/`、兩份資產URL、bootstrap及commands匿名請求均302；原機器bootstrap和commands讀取均200，scope相符。未提交額外測試命令；302狀態本身不證明redirect目的地或未夾帶受保護內容；機器成功不能代替真人Access或手機驗收。已上傳的bytes由source／manifest／request receipts支持，尚未用真人session重新下載比對。

## 保留的停止與失敗

第一次發布被自動核准審查拒絕：先前「按建議繼續」不足以明確授權可能影響服務的原Worker部署。拒絕發生在process建立前，當時沒有assets-session或publish intent；只保存本機準備資料，未繞過。之後owner明確批准原Worker／D1／Access／secret／期限及零新增付費範圍，重新核對通過才執行。

第一次部署後檢查在domain整個陣列相等比較失敗。按id排序後四筆records逐項相等，差異只有API回傳順序；保存失敗及對帳結果，接續未完成的Access／D1檢查，沒有重播部署。

## 可重用操作次序

1. 固定target、source commit、三份hash及原授權期限；核對目前version、binding、Access、domain、D1應用狀態及runner。已到期或前態漂移就停止重新評估，不套用舊腳本。
2. 保存舊version及具體回退request。依[Cloudflare direct upload流程](https://developers.cloudflare.com/workers/static-assets/direct-upload/)登記manifest、上傳缺少的assets、取得completion token，再發布完整且未變的Worker modules與新assets；保留secret及routing。
3. 主導檢視的私人helper以exclusive-create保存具名request／transport／response；可見operator另保存asset bucket intent。T825未取得helper，沒有獨立確認其持久化或retry行為。遇未知結果必須先對帳，不得重跑已用腳本或更換label繞過既有紀錄；這是操作規程，不宣稱完整restart-safe自動化。發布前重讀deployment／settings可偵測已發生的漂移，但不是原子鎖，不能排除核對後的競爭。
4. 回讀新100%版本與所有原設定／授權／資料；domain清單按穩定id比較。記錄匿名302與原機器scope查詢成功後，才請owner進行一般瀏覽器真人流程。異常時先確認實際狀態，再決定是否使用保存的回退request。
5. Owner以桌面或手機瀏覽器登入原Access，提交一次固定唯讀檢查並下載JSON。記錄命令ID、畫面與下載觀察，再由主導核對D1／journal／artifact。不可要求cookie、JWT、OTP或callback；到期不自動續權。

獨立T825審查針對本輪自動部署證據與公開聲明；實體手機、完整主線、回退演練及實際帳單不在已完成證據內。回歸121tests／U9十組本機瀏覽器是PR697歷史證據，本輪未重跑產品測試、未修改產品程式。

## 獨立審查與主導修正

T825的兩個早期方案均被自動核准審查拒絕，理由是私人部署衍生資料送往具名外部模型尚缺明確授權；兩次均未啟動模型。Owner後續批准限定範圍後，執行一次gpt-6-astra/high、180秒host timeout的inline審查，約64秒退出0。工具／網路／MCP／apps／委派禁用，輸入先掃描私人profile識別值及secrets；events只有模型回答，無工具呼叫、stderr或turn error。

獨立結論為REWORK，要求明確歸屬主導證據、限定匿名302的含義、說明未提供helper的檢視限制、區分操作規程與restart-safe保證，以及定義resources投影。主導已逐項修正本文件，沒有追加模型呼叫，也不將修正文案稱為reviewer ACCEPT。原始REWORK及兩次拒絕完整保留；[T825報告](../../../.team/reports/T-825.md)說明主導修正與未獨立重審的界線。

DR01–03僅代表本輪自動部署證據；DR04、完整主線、回退演練、真人session資產下載比對及實際帳單仍未完成。正常PR／CI／merge／遠端回讀屬Git交付，不能替代這些驗收。

## Owner調整客戶端驗收範圍

2026-10-28 owner明確表示手機不用測。實體手機、觸控及裝置相容性改為選測，不再阻擋後續開發；這是需求縮減，不是補做或通過手機測試。DR04的真人Access操作可以用一般桌面瀏覽器完成，與機器profile驗證仍分開記錄，不要求為手機單獨建立授權。

此時原短期授權已到期；本次只調整驗收範圍，沒有續權、重啟runner或啟用Cron。真人登入／提交／下載仍未驗證，可在下一次正常使用窗口順帶補驗；不因移除手機門檻把完整主線改成passed。

建議下一個開發範圍是常態唯讀運維：明訂授權續期／撤銷與機器憑證輪替、runner恢復，再驗證低頻排程、結果保留及配額上限。Grok接入沿用相同命令API。這是後續優先順序建議，尚未批准新的有效期限、Cron、付費或其他雲端變更。
