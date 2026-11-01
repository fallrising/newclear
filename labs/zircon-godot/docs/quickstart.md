# 起步與驗收路線

**2026-10-23：build 與 headless editor import 已通過；遊戲啟動仍 blocked。** 工具版本、命令與限制見 [本次證據](development-20261023.md)。合法素材與圖形環境仍未提供，以下遊戲操作不能標為已跑通。先讀 [SDD 契約](sdd/README.md)。

## P0：先準備四樣東西

1. 可執行 Godot .NET desktop 的測試機。第一輪建議 Linux，以對齊 headless server 路徑；Mac／Windows 支援需各自實測。
2. .NET 10 SDK，以及與專案 `Godot.NET.Sdk/4.6.3` 相符的 Godot .NET 版本。
3. 有來源與使用依據的測試資料：System.db、必要地圖、圖庫、聲音及 client JSON。將原件與可寫實驗副本分開，確認 client/server 使用同一套定義。
4. 一份 runtime path 表：server binary directory、Server.ini、Database、MapPath、client Data、ClientData。根據消費它們的讀取器核對，見[來源表](evidence.md)。

固定來源取得與工具版本已實測；以下以可移植路徑示範重跑方式。上游 checkout 與素材保持 newclear 外置。

```bash
git clone https://github.com/iamcheyan/Zircon-Godot.git
cd Zircon-Godot
git checkout --detach e383d4a020c46acce37a845eae5cc84a867ecffc
git rev-parse HEAD
```

期望 SHA 完全相符。接著只查工具版本，不啟動遊戲：

```bash
dotnet --info
godot-mono --version
```

若 Godot 可執行檔名稱不同，先找到已安裝的 .NET 版本；不要用非 .NET Godot 代替。

## P1：先建置，再配資料，最後啟動

從 newclear root 使用本次新增工具。先將 `WORKSPACE` 指向共用 `workspace.py`，`SOURCE` 指向外置固定 checkout，`DOTNET` 指向 .NET 10 可執行檔；`LAB` 指向本目錄的絕對路徑。每次使用新 task ID。以下 build entrypoint 已實測；它檢查 41 個來源 blob，拒絕錯誤 SHA、staged／未知 tracked 改動及未被 Git ignore 的未追蹤輸入，只容許已知 shutdown patch。ignored 檔案及工具鏈設定仍可能影響建置；此檢查不是 hermetic build 或完整輸入封存保證。

```bash
python3 "$WORKSPACE" run zircon-godot local-build -- \
  python3 labs/zircon-godot/scripts/build.py --source "$SOURCE" --dotnet "$DOTNET"
```

建置 ServerCore、GodotClient 與 legacy GroundLootChecks；stdout 指向 evidence log。輸出、NuGet cache 及 Godot intermediate 均在 task workspace，沒有改全域 SDK 或 repo 的 package manager。`build-results.json` 記錄來源／SDK／patch／binary hashes。build 通過不會自動啟動 server。

### Host shutdown 修補與 RED/GREEN

原始 host 的 Ctrl-C 未設定 `e.Cancel`，而主迴圈阻塞於 `Console.ReadLine`。本次 [patch](../patches/0001-graceful-console-stop.patch) 改成等待世界退出，讓既有 save／commit 有機會完成。用獨立 .NET process、真實 SIGINT 與保持開啟的 stdin 驗證；world 是 test double，不是 MirDB 驗收。

```bash
# 在乾淨固定 checkout 上先跑：預期兩項 FAIL（RED）。
python3 "$WORKSPACE" run zircon-godot host-red -- \
  env DOTNET="$DOTNET" ZIRCON_SOURCE="$SOURCE" \
  python3 -m unittest discover -s labs/zircon-godot/tests -v

git -C "$SOURCE" apply --check "$LAB/patches/0001-graceful-console-stop.patch"
git -C "$SOURCE" apply "$LAB/patches/0001-graceful-console-stop.patch"

# 同一測試預期兩項 PASS（GREEN），再重跑 build。
python3 "$WORKSPACE" run zircon-godot host-green -- \
  env DOTNET="$DOTNET" ZIRCON_SOURCE="$SOURCE" \
  python3 -m unittest discover -s labs/zircon-godot/tests -v
```

撤回使用 `git apply --reverse --check` 後 `git apply --reverse` 同一 patch，保留其他修改。這是 host 修補回退，不是 AC-04 的 gameplay 規則修改／revert。該 patch 已經 T-978 獨立 static review；只測試已 ready 的 host，未證明啟動中途 Ctrl-C 或 SIGTERM 可正常保存。

### Editor 載入

`GODOT` 為官方 4.6.3 .NET executable，`DOTNET_ROOT` 為其 .NET 安裝目錄，`CLIENT_BIN` 為 build task 的 `build/ZirconClient`。工具複製 project 至 task build dir、使用隔離 editor settings，任何 `ERROR:` 即視為失敗；不啟動遊戲場景，不算 desktop 驗收。

```bash
python3 "$WORKSPACE" run zircon-godot editor-check -- \
  python3 labs/zircon-godot/scripts/check_editor.py --source "$SOURCE" \
  --binaries "$CLIENT_BIN" --godot "$GODOT" --dotnet-root "$DOTNET_ROOT"
```

### 素材 consumer 路徑（依固定來源重新核對）

| Consumer | 實際解析規則／需補內容 |
| --- | --- |
| ConfigReader | `Server.ini` 相對 server cwd；不要沿用上游作者設定 |
| MirDB Session | server binary directory 下 `Database/System.db`、`Database/Users.db`；後者僅隔離實驗副本 |
| Server Map | `Config.MapPath` 相對 cwd 或絕對路徑，再加 `<MapInfo.FileName>.map` |
| DatabaseLoader | `MIR3_EI_ROOT/Data/System.db`，其次 home mirror，再上游 `Debug/Client/Data`；須看實際載入 log，不能接受意外 fallback |
| MirSkin/LibraryCache | `ZIRCON_UI_DATA_PATH` 優先，否則 `MIR3_EI_ROOT/Data`；另有歷史 fallback |
| 預設 legacy UI | `ZIRCON_LEGACY_UI_DATA_PATH`，或 EI/LegacyEI Data 候選；與 world 圖庫分開 |
| GameScene/MapView | **固定**上游 `Debug/Client/Map/<name>.map`，不受 `MIR3_EI_ROOT` 控制 |
| GameScene sound | **固定**上游 `Debug/Client/Sound/`，不受 `MIR3_EI_ROOT` 控制 |
| DataLayer | `ZIRCON_CLIENT_DATA`、project `ClientData`、上游 `ClientData`、cwd fallback；需要 frame-formulas、magic-effects、sounds 三個 JSON |

路徑規則已核對；資產實際路徑、來源／使用依據、hash、角色／map 身份尚缺。取得後先填私人 run record（repo 外），核對 client/server System.db 同一內容，才建立可寫資料副本及必要資源連結。不啟動空白 DB 當基線。

server 設定至少核對 `IPAddress=127.0.0.1`、game port、user-count port、`MapPath`、WebServer disabled；不把上游作者的 config 或帳密原樣使用。不啟用 `--singleplayer-dev` 作為普通資料驗證。server 的 `MapPath` 預設並非任意 runtime 目錄都適用。

資料齊備後，將 `SERVER_RUNTIME` 設為 build task 的 `build/ServerCore`（確認不重複運行同一資料副本），人工啟動（`skipped`）：

```bash
cd "$SERVER_RUNTIME"
"$DOTNET" ServerCore.dll
```

client 實際啟動前，需把 client binaries 配至 Godot 的 `.godot/mono/temp/bin/Debug`，並按上表配置 resources（editor staging 不包含外置 assets）。以下入口尚未驗證；顯式 endpoint 避免 auto launcher 啟動額外程序（`skipped`）：

```bash
"$GODOT" --path "$SOURCE/GodotClient" -- --server 127.0.0.1 --port 7000 --window
```

`MIR3_EI_ROOT` 可影響 client database 候選路徑，但不保證覆蓋所有素材 resolver。啟動前按 P0 設定 client 路徑，觀察 DB 實際載入位置。帳號從 UI 建立／登入，避免在命令列、截圖或公開 log 放密碼。

## P2–P4：每次只跨一個門檻

| 順序 | 操作 | 應留證據 |
| --- | --- | --- |
| 1 | 登入、選角、進入已知地圖 | 連線階段、map ID、角色位置、可辨識畫面 |
| 2 | 走一格；嘗試走向已知障礙 | server 權威位置與 client 校正結果 |
| 3 | 正常停止 server、重新啟動登入 | 同一角色的指定持久狀態前後比對 |
| 4 | 一次戰鬥、掉落、拾取 | HP／物品數量在 server 與 client 的一致性 |
| 5 | 修改單一既有規則，重跑前四項，再 revert | 相同輸入下的預期差異與恢復基線 |

套用已測 host patch 後，server ready 才用 Ctrl-C，等待結束並檢查真實保存結果。未修補原始 host 的 Ctrl-C 已證實會提前退出；本次不宣稱 SIGTERM 或啟動途中的訊號安全。上游 auto launcher 會 kill 它所建立的 server／bot，不能拿那條路徑證明正常保存。

## 失敗時先分類

| 症狀 | 第一個檢查點 |
| --- | --- |
| restore/build 失敗 | SDK 精確版本、套件來源、只建置指定專案 |
| TCP 未通 | server 是否啟動成功、IP／port、listener／錯誤日誌 |
| 可登入但進不了世界 | System.db、角色與地圖定義、server map 檔 |
| 世界狀態正常但畫面空白／錯圖 | client 圖庫路徑、大小寫、圖像 index、資源版本 |
| 移動抖動／退回原位 | C.Move → server 拒絕原因 → S.UserLocation，不先調動畫速度 |
| 重啟丟失狀態 | 是否正常結束、真正 Users.db 路徑、Save/Commit 結果 |

如缺合法可用的原始素材，停在文件／協定與自製 fixture 研究，不把缺資源包裝成遊戲跑通。不要使用 README 中的外部 `login_game.sh` 路徑作為已存在於本 checkout 的保證。
