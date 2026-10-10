# 來源、閱讀範圍與驗證

研究日期：2026-10-04（Asia/Singapore）。來源 commit：`e383d4a020c46acce37a845eae5cc84a867ecffc`。

## 證據如何解讀

- **上游聲稱**：README 與專項審計描述的可玩能力／結果。
- **靜態確認**：本輪閱讀程式入口、依賴、分支、序列化與資料流所得。
- **設計推論**：我們的學習階段、契約與驗收選擇，尚未實作。
- **本地實測**：本輪只有文件、來源與索引檢查；没有遊戲 build/runtime 結果。

本次取得完整 recursive tree（未截斷），定位後取得 41 個文件／程式檔。大型 GameScene、PlayerObject、SEnvir 等以具名操作鏈閱讀，未逐行審查全部玩法、資安、編輯器或素材。檔案取得與閱讀程度記在 [sources.json](../sources.json)，不把取得檔案數當成全量 code audit。

## 可定位來源

| ID | 支持的主題 | 固定版本來源 |
| --- | --- | --- |
| E00 | 來源 tree／授權檔觀察 | [固定 tree](https://github.com/iamcheyan/Zircon-Godot/tree/e383d4a020c46acce37a845eae5cc84a867ecffc)；[完整讀取清單](../sources.json) |
| E01 | 專案定位與現況聲稱 | [README.md](https://github.com/iamcheyan/Zircon-Godot/blob/e383d4a020c46acce37a845eae5cc84a867ecffc/README.md) |
| E02 | fork 分歧／選擇性移植 | [docs/UPSTREAM_SYNC_POLICY.md](https://github.com/iamcheyan/Zircon-Godot/blob/e383d4a020c46acce37a845eae5cc84a867ecffc/docs/UPSTREAM_SYNC_POLICY.md) |
| E03 | 宿主與精確依賴 | [ServerCore/Program.cs](https://github.com/iamcheyan/Zircon-Godot/blob/e383d4a020c46acce37a845eae5cc84a867ecffc/ServerCore/Program.cs)；[ServerCore/ServerCore.csproj](https://github.com/iamcheyan/Zircon-Godot/blob/e383d4a020c46acce37a845eae5cc84a867ecffc/ServerCore/ServerCore.csproj)；[GodotClient/ZirconClient.csproj](https://github.com/iamcheyan/Zircon-Godot/blob/e383d4a020c46acce37a845eae5cc84a867ecffc/GodotClient/ZirconClient.csproj)；[GodotClient/project.godot](https://github.com/iamcheyan/Zircon-Godot/blob/e383d4a020c46acce37a845eae5cc84a867ecffc/GodotClient/project.godot) |
| E04 | server state／move／怪物 | [ServerLibrary/Envir/SEnvir.cs](https://github.com/iamcheyan/Zircon-Godot/blob/e383d4a020c46acce37a845eae5cc84a867ecffc/ServerLibrary/Envir/SEnvir.cs)；[ServerLibrary/Envir/SConnection.cs](https://github.com/iamcheyan/Zircon-Godot/blob/e383d4a020c46acce37a845eae5cc84a867ecffc/ServerLibrary/Envir/SConnection.cs)；[ServerLibrary/Models/PlayerObject.cs](https://github.com/iamcheyan/Zircon-Godot/blob/e383d4a020c46acce37a845eae5cc84a867ecffc/ServerLibrary/Models/PlayerObject.cs)；[ServerLibrary/Models/Monsters/OmaMage.cs](https://github.com/iamcheyan/Zircon-Godot/blob/e383d4a020c46acce37a845eae5cc84a867ecffc/ServerLibrary/Models/Monsters/OmaMage.cs) |
| E05 | 協定 | [LibraryCore/Network/Packet.cs](https://github.com/iamcheyan/Zircon-Godot/blob/e383d4a020c46acce37a845eae5cc84a867ecffc/LibraryCore/Network/Packet.cs)；[LibraryCore/Network/BaseConnection.cs](https://github.com/iamcheyan/Zircon-Godot/blob/e383d4a020c46acce37a845eae5cc84a867ecffc/LibraryCore/Network/BaseConnection.cs)；[LibraryCore/Network/ClientPackets.cs](https://github.com/iamcheyan/Zircon-Godot/blob/e383d4a020c46acce37a845eae5cc84a867ecffc/LibraryCore/Network/ClientPackets.cs)；[LibraryCore/Network/ServerPackets.cs](https://github.com/iamcheyan/Zircon-Godot/blob/e383d4a020c46acce37a845eae5cc84a867ecffc/LibraryCore/Network/ServerPackets.cs)；[docs/NETWORKING.md](https://github.com/iamcheyan/Zircon-Godot/blob/e383d4a020c46acce37a845eae5cc84a867ecffc/docs/NETWORKING.md) |
| E06 | MirDB | [LibraryCore/MirDB/Session.cs](https://github.com/iamcheyan/Zircon-Godot/blob/e383d4a020c46acce37a845eae5cc84a867ecffc/LibraryCore/MirDB/Session.cs)；[LibraryCore/MirDB/DBCollection.cs](https://github.com/iamcheyan/Zircon-Godot/blob/e383d4a020c46acce37a845eae5cc84a867ecffc/LibraryCore/MirDB/DBCollection.cs)；[docs/DATA_MODEL.md](https://github.com/iamcheyan/Zircon-Godot/blob/e383d4a020c46acce37a845eae5cc84a867ecffc/docs/DATA_MODEL.md) |
| E07 | Godot 輸入／連線／資料載入 | [GodotClient/Network/NetworkManager.cs](https://github.com/iamcheyan/Zircon-Godot/blob/e383d4a020c46acce37a845eae5cc84a867ecffc/GodotClient/Network/NetworkManager.cs)；[GodotClient/Network/ServerConnection.cs](https://github.com/iamcheyan/Zircon-Godot/blob/e383d4a020c46acce37a845eae5cc84a867ecffc/GodotClient/Network/ServerConnection.cs)；[GodotClient/Network/DatabaseLoader.cs](https://github.com/iamcheyan/Zircon-Godot/blob/e383d4a020c46acce37a845eae5cc84a867ecffc/GodotClient/Network/DatabaseLoader.cs)；[GodotClient/Network/SinglePlayerLauncher.cs](https://github.com/iamcheyan/Zircon-Godot/blob/e383d4a020c46acce37a845eae5cc84a867ecffc/GodotClient/Network/SinglePlayerLauncher.cs)；[GodotClient/Scripts/GameScene.cs](https://github.com/iamcheyan/Zircon-Godot/blob/e383d4a020c46acce37a845eae5cc84a867ecffc/GodotClient/Scripts/GameScene.cs)；[GodotClient/Scripts/LoginScene.cs](https://github.com/iamcheyan/Zircon-Godot/blob/e383d4a020c46acce37a845eae5cc84a867ecffc/GodotClient/Scripts/LoginScene.cs) |
| E08 | 地圖與圖庫 | [GodotClient/Formats/MapReader.cs](https://github.com/iamcheyan/Zircon-Godot/blob/e383d4a020c46acce37a845eae5cc84a867ecffc/GodotClient/Formats/MapReader.cs)；[GodotClient/Formats/ZlReader.cs](https://github.com/iamcheyan/Zircon-Godot/blob/e383d4a020c46acce37a845eae5cc84a867ecffc/GodotClient/Formats/ZlReader.cs)；[GodotClient/Formats/LibraryCache.cs](https://github.com/iamcheyan/Zircon-Godot/blob/e383d4a020c46acce37a845eae5cc84a867ecffc/GodotClient/Formats/LibraryCache.cs)；[GodotClient/Scripts/DataLayer.cs](https://github.com/iamcheyan/Zircon-Godot/blob/e383d4a020c46acce37a845eae5cc84a867ecffc/GodotClient/Scripts/DataLayer.cs) |
| E09 | 已有驗證與範圍限制 | [Tests/GroundLootChecks/GroundLootChecks.csproj](https://github.com/iamcheyan/Zircon-Godot/blob/e383d4a020c46acce37a845eae5cc84a867ecffc/Tests/GroundLootChecks/GroundLootChecks.csproj)；[Tests/GroundLootChecks/README.md](https://github.com/iamcheyan/Zircon-Godot/blob/e383d4a020c46acce37a845eae5cc84a867ecffc/Tests/GroundLootChecks/README.md)；[BotRunner/Program.cs](https://github.com/iamcheyan/Zircon-Godot/blob/e383d4a020c46acce37a845eae5cc84a867ecffc/BotRunner/Program.cs)；[docs/MAGIC_FULL_AUDIT.md](https://github.com/iamcheyan/Zircon-Godot/blob/e383d4a020c46acce37a845eae5cc84a867ecffc/docs/MAGIC_FULL_AUDIT.md) |

## 本輪關鍵交叉核對

1. 專案檔為 `net10.0`；Godot SDK 固定 `4.6.3`，不能只抄 README 的「Godot 4.x」。
2. `NetworkManager._Process` 採同步 TCP polling，並在重連清除半包；不套用舊 client 的收包執行模型。
3. `Packet.ReceivePacket` 已有 6 bytes–64 MiB 長度限制與非法 ID 拒絕；同 SHA 的 NETWORKING 文件仍寫無明確上限，採原始碼為準。
4. `GroundLootChecks.csproj` 連結的是舊 `Client/Models` 檔案，不是 Godot 整體回歸測試。
5. `BotRunner/Program.cs` 將數量 clamp 在 1–20；這不是最大併發能力的量測。
6. `SinglePlayerLauncher` 可使用 dev 資料注入、啟動 bots，退出以 kill 結束自有進程；普通存檔驗收須單獨設計。
7. `Config.MapPath` 預設與 runtime cwd、MirDB binary-relative root 不可混為一談；路徑解析本身是 P0 交付。

## 驗證結果

| 驗證 | 結果／範圍 |
| --- | --- |
| 固定來源清單 | pass：41 個檔案的 path／blob SHA／size 對應固定 tree |
| 文件相對連結、固定來源路徑 | pass：見本輪提交前執行的靜態檢查；不包含外部站點可用性保證 |
| source manifest JSON | pass：可解析，SHA 格式與唯一 path 檢查 |
| .NET／Godot 環境 | blocked：本環境 `command -v dotnet/godot/godot-mono` 均未找到 |
| ServerCore／GodotClient build | skipped：缺 SDK／engine，未下載依賴或建置 |
| 上游 GroundLootChecks／BotRunner | skipped：未執行，且其範圍不能取代 Godot E2E |
| 登入、移動、戰鬥、畫面、存檔還原 | skipped：無完整執行資源，沒有啟動服務 |

本文件的 pass 僅限提交前通過的靜態門檻。runtime 案例如何留證見 [SDD C4](sdd/README.md)；操作入口見 [quickstart](quickstart.md)。

