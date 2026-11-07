# M1 dashboard browser evidence — 2026-10-28

本輪[UI-01～04](../dashboard-qualification.md)完成本機看板修正與真實瀏覽器矩陣。新資產尚未部署到遠端；真正Access登入與實體手機驗收仍pending。沒有修改Worker／D1 schema／runner、原Lab服務、雲端資源或授權窗口。

## 行為與結果

| 場景 | 實際證據 |
| --- | --- |
| 登入HTML／401／403／redirect | 清空命令、摘要、workspace／node／recipe及觀測時間；停用操作並停止5秒poll；明確重新整理才重驗登入；API不跟隨登入redirect |
| 成果操作403 | 同樣清除授權與資料；手動恢復後清除舊錯誤，不只處理background refresh失敗 |
| 提交已保存但回覆遺失 | Chromium可能自行重送TCP請求；fixture持續切斷回覆，所有body bytes一致、D1只有一筆；UI保留原提交，經401及明確恢復後手動重試仍使用原key／deadline／bytes |
| 真正執行與成果 | browser click→實際workerd／D1→Python OS collector→validated result；下載JSON與控制面原artifact解析後相等 |
| 一般斷線 | 保留舊資料、標示未確認、停用操作；實際時間經過30秒觀測窗口後，舊completed卡片顯示過期；沒有改鐘製造結果 |
| 取消 | UI點擊到真正Worker；未派送命令成cancelled_before_dispatch，取消意圖文案仍不宣稱程序停止 |
| unknown | 合成runner經HMAC向真正Worker回報unknown，UI明示對帳中／未知，D1 active1保留；這不是額外的OS中斷案例 |
| 唯讀權限 | grant改為commands:read後明確刷新：保留歷史，禁止提交、取消及成果下載；不借用機器token |
| 手機尺寸 | Chromium154.0.8037.57，320／390px、touch設定、原始資產、已有中文字型；沒有水平溢出；重新整理按鈕不再換行 |

Client以manual redirect處理API，讀取stream超過32768bytes立即取消，不先無界讀完整body。401／403保留status及可用request ID；HTML登入頁在讀取前分類。授權失效使舊in-flight回應失效，避免重新填回被清除的資料。重試按鈕亦檢查當前submit及recipe能力。命令摘要改成符合API的「本次回傳最多20筆」。

## 已執行驗證

- 共用launcher執行`python3 platform/cloud-lab/tools/check.py`：UI-race-green為37 Node＋84 Python＝121tests，全數通過。新增6項回歸覆蓋HTML／redirect／status、有界stream取消、重試POST撤權及舊artifact成功／拒絕競爭。
- 共用launcher及180秒host timeout執行`node platform/cloud-lab/tools/qualify_dashboard.mjs <existing-browser> <existing-toolchain> <existing-font-dir>`：U9十組檢查通過，browser.json記錄72次API請求、無JS exception或gateway error、版本及三份資產SHA-256。主導核對hash與目前source一致。
- U9保護evidence保存desktop、320／390px、四種auth失效、offline-stale、unknown截圖、下載成果及stderr。主導實際查看桌面與320px截圖；CDP採pipe，沒有debug TCP listener。Miniflare5.20261023.0-beta，沿用已安裝工具。
- T824初審REWORK發現重試POST401／403可能清掉pending，以及舊artifact完成／拒絕可能使新session再次失效。三個CI回歸在UI-race-red全部失敗，U8瀏覽器亦重現pending遺失；修正後UI-race-green全過，U9在真實瀏覽器驗證這些競爭。[Focused review T824](../../../../.team/reports/T-824.md)已ACCEPT，主導檢查兩輪events無失敗命令／拒絕／模型turn錯誤。

收尾index／project validators、M1 scope/link audit、T824 task/report及working/staged diff檢查全部通過：44專案契約、7 llms、37文件／283連結／12固定來源。公開邊界檢查及Worker／schema／runner未改動已核對；正常PR／CI／merge／remote readback作為Git交付步驟。

## 保留的失敗

UI-client-red兩項新測試如預期失敗；該次sandbox另禁止loopback sockets，既有整合測試有15項Python error及Node HTTP失敗，不當成產品回歸。取得執行許可後重跑，完整suite通過。

既有Chrome最初缺系統libatk；改用已存在的Chromium及其library目錄，未安裝或修改系統。第一次browser sandbox因listen EPERM停止。准許loopback後，長TMPDIR使Chromium SingletonSocket超過Unix長度限制；第一次harness pipe error未捕獲，後續補上持久stderr／pipe錯誤處理與finally回收。只讀檢查那次自有process group已無成員，保留needs-review manifest且不重用或清理。

使用launcher支援的短root後，U1發現Chromium會自行重送被切斷的POST，原單次丟棄fixture不足以穩定製造不確定回覆；改為持續丟棄直到手動重試。U2因按鈕定位依賴命令同時刻排序而誤點成果，改按確切取消文字定位。U3在原產品程式重現HTML登入頁未清空卡片／摘要的失敗。修正後U4通過，U5／U6擴充成果、過期、unknown及操作級撤權；U7核對最終資產。早期截圖缺中文字型，後續沿用既有Noto字型，沒有將字型或瀏覽器加入repo。

既有Node experimental SQLite提示保留。瀏覽器stderr含環境GLib／DBus診斷；不等同產品JS exception。工具只用合成本機可信頁面，Chromium no-sandbox不代表安全隔離；不能拿來測私人登入或外部網站。

## 剩餘門檻

本輪是合成JWT下的本機瀏覽器／真正workerd邊界，不是Cloudflare Access provider、實體手機、Safari、觸控實機、鍵盤或螢幕閱讀器驗收。新版遠端資產部署與owner登入操作仍待接續。AC06–08、T-0003-4保持pending／in_progress，mainline=incomplete、usable_tag=none。Grok、排程及其他adapter未包含在本輪。
