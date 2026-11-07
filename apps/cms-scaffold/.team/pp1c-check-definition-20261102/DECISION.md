# 已批准：只接受九組既有 CHECK 的已觀察表示配對

狀態：APPROVED（2026-11-06）；必要審查／CI、正常合併與遠端核對尚待完成。Desk T-0351。產品仍fail closed，C未完成，D未開始。

第五次真實還原的20表rows、全部columns/indexes與其餘constraint metadata、Flyway、assets/variants及17檔14089bytes都相等；9個CHECK字串在7表不同，因此RAW_MISMATCH，revoke從未開始。source d435e35966614c69863c11fbaa3502e6、target2556a8dbd8e547beb2ad87bcd4fc47cd、operation9a58a51f-2234-4e57-92b6-13c9801faf92。兩組6容器均已停止，target API/ingress從未啟動，全部volumes、bundle、raw inventories、鎖與失敗證據保留。

建議批准一個完整窄幅修訂：僅對下表9組完整、定向字串配對接受schema比較；保留兩端原始inventory／hash，其他schema/rows/files照舊exact；還原收據rawSnapshotSha256固定綁target RAW_VERIFIED完整raw DB snapshot，source由manifest與raw comparison另行綁定。這是新決定，沒有回溯擴張PR956／975批准。

| Table | Constraint |
| --- | --- |
| cms_content_type | cms_content_type_slug_policy_chk |
| cms_entry | cms_entry_state_chk |
| cms_entry_index | cms_entry_index_kind_chk |
| cms_entry_index | cms_entry_index_scope_chk |
| cms_entry_ref | cms_entry_ref_kind_chk |
| cms_field | cms_field_on_delete_chk |
| cms_field | cms_field_visibility_chk |
| cms_navigation_menu | cms_navigation_menu_state_chk |
| cms_principal | cms_principal_status_chk |

完整兩邊字串與flags見 [配對表](../../docs/v2/contracts/fixtures/pp1c-check-definition-pairs-v1.json)。SHA256：`321c4c27feb93fe4118f72785e79f6df720d0bc825d4d2a2c96f53bf343012d1`。只限既有PG完整image6a2e…與server/dump/restore16.15、同版release及Flyway lineage。不是regex接受任意CHECK、不是SQL語義推測器；反向、其他版本、任何literal/順序/type/flags/name或其他catalog差異都拒絕。

原規格在PP1c§5要求 `pg_get_constraintdef(oid,false)` 原字串，不自行正規化；附約要求完整schema equality；parent§11假設兩端dbSnapshot相等。因此不能默默套例外或自行選target hash。提案保留raw輸出，只改9組比較例外和target hash的明確來源。

PostgreSQL官方說明該函式回傳的是反編譯重建文字；官方郵件中Tom Lane也解釋相同array cast改寫是deparser將隱式cast顯式輸出。這支持本案表示差異診斷，不授權一般SQL等價或證明C已完成：[PG16 documentation](https://www.postgresql.org/docs/16/functions-info.html)、[same-shape report](https://www.postgresql.org/message-id/CAG9XPVk0j9isO-q2Uv%2B2E3keaTGm8fxx%3Dw558xe1vf0O7djT%3DQ%40mail.gmail.com)、[Tom Lane response](https://www.postgresql.org/message-id/30073.1459287952%40sss.pgh.pa.us)。

替代選擇是維持原字串完全相等；目前這個預設migration→同PG16 dump/restore會持續RAW_MISMATCH，C/D不能宣稱完成。沒有修改migration、重寫source schema或忽略CHECK的建議。

批准後仍先正式文件／獨立審查／CI／正常合併與遠端核對，再實作固定pair比較與validator回歸、fresh實機raw/revoke、C交付，之後D。未批准前Draft不合併、產品不實作新政策。新runtime、全部舊runtime/volumes/locks保留；不release/deploy或擴權。完整provider/tool/token/cost/active-wait統計unknown/null。

## 2026-11-06 owner 決定

Owner最新原話「批准。」明確回覆上一輪PR1012九組CHECK配對與target RAW snapshot完整提案。精確發言時間未知；本輪首次決定記錄 2026-11-06T15:19:35Z（2026-11-06 23:19:35 SGT）。批准來源是本session user訊息；不是換session或Git持續授權推論。

批准的proposal head為d99347461a787eb6b4724d5bac93651253785d6c，原fixture SHA321c4c27feb93fe4118f72785e79f6df720d0bc825d4d2a2c96f53bf343012d1保留。fixture只將status改APPROVED；九組definitions、metadata、方向及四項PG profile逐值未變。現行批准fixture SHA256：`f25157feb8a0c027f1b8930c4fad64fe7e0291e0745702d2e2a3b727533e856a`。

2026-11-02提案及失敗敘述為歷史；本次批准不宣稱C成功、未開始D。先完成批准狀態獨立審查、新head必要CI、正常合併與完整遠端bytes核對，再進行有界實作及fresh實機C。所有未提交來源、ignored scripts/local、原始證據與舊runtime/volumes/locks保留；不release/deploy或擴權。
