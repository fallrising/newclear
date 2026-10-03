# Quickstart — M0 契約驗證

目前可以執行離線契約檢查，尚無可啟動的 Signal Hub 服務。

從 repository 根目錄執行：

```sh
python3 -m venv /tmp/signalhub-contracts
/tmp/signalhub-contracts/bin/pip install --only-binary=:all: -r platform/signal-hub/contracts/requirements.txt
/tmp/signalhub-contracts/bin/python platform/signal-hub/contracts/check.py
```

本次已在 Python 3.12 隔離環境安裝並執行相同 requirements 與 checker；安裝完成後檢查只讀本地檔案。細節見 [契約](../contracts/README.md)。

| 驗證種類 | 狀態 | 邊界 |
| --- | --- | --- |
| schemas／正反 fixtures | 可執行 | 結構、格式、設定語意及 data bytes |
| webhook／canonical vectors | 可執行 | 合成輸入，沒有 HTTP 接收端或持久化去重 |
| OpenAPI | 可執行 | 文件結構與引用，不代表 endpoint 已實作 |
| Go、UI、SQLite、部署 | 未實作 | M1 起逐階段處理；部署需另行授權 |

進度與限制見 [STATUS](STATUS.md)。
