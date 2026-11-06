# 來源快照

`manifest.json` 是這次 Gameplay Atlas 公開來源的分母。筆記篇數不能反過來證明它完整。

本次快照 `atlas-public-2026-11-02` 對過五個公開入口：sitemap、首頁使用的 `index.json`、`catalog.json`、每個機制頁內嵌的 `atlas-entry`，以及 `mechanics/<id>.json`。頁面、mechanic JSON 與 catalog 的文字投影雜湊必須相同。圖片與案例長文不進入雜湊，也不進筆記。

```sh
python3 sources/inventory.py --check
python3 sources/inventory.py --fetch
python3 sources/text_cache.py --check
```

`--check` 不連網。`--fetch` 以約每 0.4 秒一個請求重讀公開入口，只在終端列出與已提交快照的 ID 或雜湊差異；它不改筆記、不寫 manifest、不發布。若要改寫 manifest，必須另存快照 ID，避免把不同時間的分母混在一起。

`sources/text/` 是已提交的文字投影，給自動對照用。它不是全文、案例或圖片。重抓入口的暫存仍不進版控。筆記由 `sources/write_notes.py` 這個維護工具產生或修補；離線建置不依賴它，也不依賴 OpenCC。
