# 起步與驗收路線

**執行狀態：skipped。** 本研究環境沒有 `dotnet`、`godot`、`godot-mono`，也沒有使用者提供的遊戲執行資源。以下是下一階段的人工操作入口，不是已跑通安裝指南。先讀 [SDD 契約](sdd/README.md)。

## P0：先準備四樣東西

1. 可執行 Godot .NET desktop 的測試機。第一輪建議 Linux，以對齊 headless server 路徑；Mac／Windows 支援需各自實測。
2. .NET 10 SDK，以及與專案 `Godot.NET.Sdk/4.6.3` 相符的 Godot .NET 版本。
3. 有來源與使用依據的測試資料：System.db、必要地圖、圖庫、聲音及 client JSON。將原件與可寫實驗副本分開，確認 client/server 使用同一套定義。
4. 一份 runtime path 表：server binary directory、Server.ini、Database、MapPath、client Data、ClientData。根據消費它們的讀取器核對，見[來源表](evidence.md)。

下列每段都未在本輪執行。使用者自行選一個 newclear 以外的工作目錄；不將 checkout 或素材提交到此目錄。

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

從上游 repo root 建置指定專案，避免直接建置整個含 Windows 工具的 solution。命令狀態皆為 `skipped`。

```bash
dotnet restore ServerCore/ServerCore.csproj
dotnet build ServerCore/ServerCore.csproj -c Release -o "$PWD/.local-runtime/server"
dotnet build GodotClient/ZirconClient.csproj -c Debug
```

期望每個 build 0 errors，warnings 原樣記錄。這個 `.local-runtime` 是未追蹤的實驗目錄；勿加入 git。正式執行前，將具來源的資料副本按 P0 的 path 表放好，確認 server 的設定解析與 MirDB binary-relative root。**不能因為 build 輸出成功就直接啟動空白資料庫並當成基線。**

server 設定至少核對 `IPAddress=127.0.0.1`、game port、user-count port、`MapPath`、WebServer disabled；不把上游作者的 config 或帳密原樣使用。不啟用 `--singleplayer-dev` 作為普通資料驗證。server 的 `MapPath` 預設並非任意 runtime 目錄都適用。

資料齊備後，在選定的 server runtime 目錄人工啟動（`skipped`）：

```bash
cd .local-runtime/server
dotnet ServerCore.dll
```

另一終端回到上游 repo root，顯式連向測試 server，避免 auto launcher 啟動額外程序（`skipped`）：

```bash
godot-mono --path "$PWD/GodotClient" -- --server 127.0.0.1 --port 7000 --window
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

停止 server 時用正常 Ctrl-C 路徑，等待結束並檢查保存結果。上游 auto launcher 會 kill 它所建立的 server／bot，不能拿那條路徑證明正常保存。

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
