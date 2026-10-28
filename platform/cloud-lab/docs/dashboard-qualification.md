# Dashboard browser qualification

Owner批准接續看板／手機操作驗收。本輪UI01–04以既有headless Chrome、產品原生HTML/CSS/JS及本機隔離HTTP／workerd完成可自動驗證的部分。沒有第三方產品runtime依賴、新套件安裝、既有服務部署、權限延長或付費升級。

| AC | 驗收 |
| --- | --- |
| UI-01 | Access401／403／登入HTML／redirect時清除舊資料與操作權限，停止自動重試；明確重新整理才重驗登入 |
| UI-02 | 暫時斷線保留標記為未確認的舊觀測，時間推移變stale；提交結果不明時僅手動重試完全相同bytes／key／deadline |
| UI-03 | 真實headless瀏覽器在桌面及窄螢幕載入原產品資產，驗證點擊、權限、unknown、取消意圖、成果與無水平溢出；保留screenshots及console errors |
| UI-04 | 本機真正Worker／D1邊界與browser流程、回歸、獨立審查及公開證據；區分合成登入與真實Access／手機驗收 |

狀態：本機UI01–04通過；[121項回歸、十組瀏覽器案例及獨立審查](evidence/m1-dashboard.md)。主導實作並以RED–GREEN驗證；T824作有界獨立唯讀審查。瀏覽器測試僅用合成身份／資料，無真實cookie或service-token注入瀏覽器；loopback不對外開放。真正Access登入、實體手機、遠端新版部署保持pending，不延長既有grant窗口，不重啟live服務。完整AC06–08不由本次本機測試自動完成。

## 重現與證據邊界

`tools/qualify_dashboard.mjs <existing-chromium> <existing-miniflare-toolchain> [existing-font-directory]`由共用launcher啟動，外層host timeout180秒。沿用既有Chromium154及Miniflare5.20261023.0-beta，不安裝、升級或把dev tool加入產品依賴。若共享root路徑太長使Chromium SingletonSocket超過Unix socket限制，使用launcher明確支援的短`--root`與短task ID；產物仍在其build／evidence，不改用任意暫存目錄。

瀏覽器profile、fontconfig/cache、workerd持久狀態與runner journal位於本次獨立build目錄；JSON成果、screenshots、錯誤及來源hash放保護evidence。CDP走繼承pipe，不開debug port。HTTP gateway只綁127.0.0.1、驗Host／Origin、限制body及路徑；本機gateway注入合成JWT，真正產品Worker照常驗簽、grant及Origin，未繞過產品認證。只對合成本機可信頁面使用Chromium `--no-sandbox`；這不是瀏覽器安全隔離或真實Access驗收，不能用此工具承載私人登入／外部頁面。

瀏覽器可能在TCP回覆遺失時自行重送同一POST；fixture持續丟棄回覆直到使用者手動重試，檢查每次bytes相同且D1僅一筆。UI本身不自動重送提交。unknown案例以合成runner HMAC向真正Worker提交unknown；沒有把它宣稱為再次完成OS中斷驗收。實際OS collector閉環、成果下載及D1驗證是另一案例。

手機尺寸使用[Chrome DevTools Emulation](https://chromedevtools.github.io/devtools-protocol/tot/Emulation/)，截圖使用[Page captureScreenshot](https://chromedevtools.github.io/devtools-protocol/tot/Page/)。320／390px及touch設定不等同實體手機、Safari、鍵盤或螢幕閱讀器驗收。
