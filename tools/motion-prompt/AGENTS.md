# Motion Prompt 工作入口

遵守根目錄 [AGENTS.md](../../AGENTS.md) 與共用交付規範。

接手先讀 [SUCCESS.md](SUCCESS.md)、[SDD.md](SDD.md) 與最近的 [證據基準](docs/evidence/baseline.md)，核對來源與目前缺口。實作前更新本次目標、範圍、AC 及驗證計畫；收尾補實際結果、未驗證項、版本及索引，不縮減原需求換取通過。

維持靜態架構、metadata／locale 單一來源；不手改 generated outputs，不用英文 fallback 掩蓋缺譯，不更動上游 ID／slug。檢查語言接線涵蓋網站、Canvas、資料與提示詞 API。翻譯不能改動動畫參數。

網站實作交付保持 Draft，最終驗收與部署另計。沒有新的發布授權時，不建立 usable tag。
