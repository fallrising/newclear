# Gameplay Pattern Catalog

以一次可追溯的 Gameplay Atlas 公開快照為分母的繁體中文設計模式筆記。先讀 [SUCCESS](SUCCESS.md) 看哪些驗收已跑、哪些還缺；需求見 [SDD](SDD.md)。

分母在 [來源 manifest](sources/manifest.json)，不是筆記篇數，也不是把舊的 14 篇精選集改名。每篇把短篇來源摘要、本地分析與未驗證原型分開，最後保留機制頁網址。來源站的圖片、全文、案例素材與程式沒有搬入，也不被本 repo MIT 重新授權。

## 入口

- [Metadata 指引](METADATA.md)：快照、來源狀態、筆記狀態與維護流程。
- [完整度報表](docs/coverage.md)：取得、reviewed、draft、pending、blocked 與缺漏 ID。
- [全部 pattern 筆記](patterns/README.md)：可在 GitHub 閱讀，不必先開網站。
- [網站 metadata](site.json)、[pattern JSON Schema](pattern.schema.json)、[來源說明](sources/README.md)。
- [驗證紀錄](docs/verification.md) 與 [任務板](docs/tasks/BOARD.md)。

## 本機使用

Runtime 只需 Python 3.11+。建置不安裝套件、不抓網路、不呼叫模型。

```sh
cd tools/gameplay-pattern-catalog
python3 sources/inventory.py --check
python3 build.py --check
python3 -m unittest discover -s tests -v
python3 build.py
python3 -m http.server 8080 --bind 127.0.0.1 --directory dist
```

瀏覽器開啟 `http://127.0.0.1:8080/`。首頁可搜尋繁中、英文、標籤與筆記內文，可按本地分類與核對狀態篩選。無 JavaScript 仍可從完整索引閱讀筆記與狀態。資源使用相對路徑。本次沒有部署。

`dist/catalog.json` 由 build 產生，包含網站 metadata、完整度與筆記內文。不要手改 `dist`、`docs/coverage.md` 或 `patterns/README.md`。

## 瀏覽器 QA

具備 Playwright 1.57.0 與 Chromium 或 Chrome 時：

```sh
python3 -m pip install playwright==1.57.0
python3 tests/browser_smoke.py
```

`--render-only` 只渲染建置結果，不驗證 URL 導航，不能當成完整瀏覽器測試。

## 維護與邊界

Markdown frontmatter 是筆記權威，manifest 是來源權威。沒有帳號、分析追蹤、遠端字型、外部圖片、背景更新或自動發布。`python3 sources/inventory.py --fetch` 只報告後續來源差異。

reviewed 表示作者對過本次快照的公開頁面，不是獨立審查，也不是實玩原遊戲。未發行 usable tag。
