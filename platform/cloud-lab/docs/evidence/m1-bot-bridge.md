# Fixed bot bridge — BC01–04

本輪交付[固定bot JSON adapter](../bot-bridge.md) source／本機驗證；沒有模型呼叫、Grok接線、live續權、Worker／Cron變更或新增付費。沿用現有API，HL資產上傳故障保持獨立開放。

| AC | 實作與證據 | 狀態 |
| --- | --- | --- |
| BC-01 | 4KiB嚴格JSON／UUIDv4／固定兩操作、trusted CLI config/state/submitflag、穩定JSON錯誤 | 本機通過 |
| BC-02 | 私人SQLite FULL commit before POST、root FLOCK、config fingerprint、精確retry、已知ACK僅GET | 本機通過 |
| BC-03 | status不POST、identity/payload關聯、freshness／unknown／stale／denied及去敏投影 | 本機通過 |
| BC-04 | RGR、真正HTTP／Python collector／CLI、完整回歸、獨立審查與Git交付 | 測試及獨立複審通過；Git結果見任務板 |

## 已執行驗證

- BC-red：13新增unit cases對缺實作stub均失敗；BC-green：實作後13通過。不是用import失敗冒充domain RED。
- BC-http：兩項Node案例通過；實際Python CLI經loopback HTTP HMAC與SQLite Worker，丟失POST ACK後server已有一筆命令，status缺ACK不聯網，同IDcheck回原command／完全相同payload。實際原Python OS collector完成回報，status得到validated，重複check不新增命令；撤銷bot grant後denied、health=null。另直接執行production CLI確認非法JSON操作只回穩定JSON錯誤。
- 補上持久化寫入失敗及DB保存非object JSON案例後，BC-corruption-red為15cases中1error：AttributeError會漏出內部traceback。新增isinstance拒絕該損壞狀態，未擴大錯誤處理到吞掉驗證結果。
- BC-regression：透過共用launcher執行`python3 platform/cloud-lab/tools/check.py`，**282項（60 Node＋222 Python）全部通過**。含所有15新unit、2新真實HTTP／CLIcases及既有runner／授權／schedule／看板回歸。Node24.14.0、Python3.13.5；本機未測Python3.11。

單元覆蓋無提交flag／未知欄位／重複key／非法ID、save-before-send、socket錯誤與ACK遺失、原期限過後同bytes重送、config漂移、scope不符、撤權去敏、unhealthy有效觀測、31秒stale／未來unverified／unknown、response身份或shape漂移、payload損壞、實際FLOCK忙碌、state權限／symlink／Git內拒絕、DB建立／INSERT失敗不送POST。

整合fixture只屏蔽launcher目錄外層Git metadata，以隔離合成state；保留fixture自身Git／symlink檢查。現有local harness將loopback映射到HTTPS Worker scope並提供合成身份，不放寬產品auth。ACK遺失注入在真正server已回應之後；不是直接塞終態或捏造collector結果。不是遠端Cloudflare／Access／實際Grok驗收，也沒有聲稱真實workerd瀏覽器測試在這輪重跑。

## 限制與交付

CLI不是MCP server或Grok SDK connector；host須固定config/state及是否允許submit，並限制stdin／程序總時長及呼叫頻率。socket5秒不是總wallclock保證。state是持久業務資料，不自動清理；request_id不是授權，新ID不是舊意圖的安全retry。沒有live命令、授權變更或第三方runtime，沒有完整主線／usabletag宣告。

[T838獨立複審](../../../../.team/reports/T-838.md)ACCEPT；主導負責文件checks、Git交付及遠端回讀，任務關閉時間見任務板。HL仍未完成，不會因BC通過而關閉。

## 審查修正與最終回歸

T838初審REWORK指出：原HTTPSClient先解析回應body，Access的HTML／超大／非JSON401或403會被bot誤投影為unconfirmed。BC-denial-red用真實本機HTTP重現。新增opt-in auth_status_only，在401／403時先回status、不讀不解析拒絕body；只有bot啟用，原probe預設不變。新HTTP案例涵蓋HTML403、64KiB HTML401及malformed JSON403，均為denied且health清空。

BC-final-regression完整 **283項（61 Node＋222 Python）通過**，包含所有既有probe及新拒絕情境；零failure／skip。初始13RED、corruption1RED、review denialRED與修正前282GREEN均保留。T838 focused review讀實作與兩份完整log後ACCEPT，未自行跑測試或讀private/live；主導檢查diff及實際輸出。沒有新增瀏覽器UI，故本輪未重跑Chromium；此工具的互動面是實際CLI／HTTP。
