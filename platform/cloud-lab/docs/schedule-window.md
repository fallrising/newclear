# 延遲 Cron 的派送窗口修正 — HW01–04

HL首次真實觸發在due後23秒才建立命令；舊實作仍以due+60秒作派送期限，原runner到整分鐘輪詢時得到expired_before_dispatch。原命令沒有attempt、result或journal execution；已停用排程並回退，詳見[HL證據](evidence/m1-health-schedule-live.md)。

Owner要求繼續開發與處理阻擋。本修正只改已登記健康排程的命令期限計算；保留原runner、15分鐘頻率、總授權截止、scope及一般API上限，不以增加輪詢或續權解決。

| AC | 驗收 |
| --- | --- |
| HW-01 | 同一UTC due分鐘內延遲23秒／59秒的callback，派送及執行期限按本次handler的now+60秒／now+120秒計算；原60秒輪詢案例能領取並回報validated結果 |
| HW-02 | due、idempotency key及not_before仍指向原排程時刻；相同due重送不更改已保存的payload或期限，不補跑前一分鐘，並行／單active護欄不變 |
| HW-03 | handler當下無完整120秒policy窗口時skip；grant／policy／runner總截止不延長，過期、撤權及dispatch重驗仍拒絕；next_due只是候選時間 |
| HW-04 | 先重現RED，再focused與完整回歸、獨立source審查與Git交付；固定新候選後依原HL授權fresh重規劃，真正Cron→原runner同鏈通過才可關閉HL |

handler的now是該次執行時間，不是持久提交完成時間；D1／網路延遲、runner離線或輪詢失敗仍可能造成過期，不承諾每次排程必定完成。修正保證不再把provider在當分鐘內的觸發延遲直接扣掉既有60秒派送預算。若callback跨分鐘，仍記skipped_misfire；不擴大catch-up。

資產與三modules仍作固定候選；重啟用需fresh確認active0、schedule disabled、Cron空、最新回退版本與原runner剩餘期限。使用新的CAS revision與UTC起點，保留第一次過期命令／firing；不重播它、不刪歷史、不重用舊JWT／not_before。截止仍不得晚於原resident保守停止時間。
