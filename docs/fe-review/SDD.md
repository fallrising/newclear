# SDD：fe-review 第 1 輪設計（newclear 的 14 個單位）

desk 卡：T-0369（原卡 T-0338 拆出的 newclear 子卡）。本檔是這張卡的需求依據（desk 運作方法 §0 N3），AC 只以本檔為準。

## 目標

newclear 的 14 個 fe-review 設計單位都交出第 1 輪 `DESIGN.md`，交給第 2 輪實作使用。每個單位的具體指示在它的 `fe-review-design` issue（#146–#159）與 [DESIGN-PROMPT.md](DESIGN-PROMPT.md)；結構照 [DESIGN-TEMPLATE.md](DESIGN-TEMPLATE.md)。順序依 DESIGN-PROMPT：A 檔、B 檔、C 檔。

## 範圍

| AC | 單位 | 檔位 | 交付物 | issue |
| --- | --- | --- | --- | --- |
| AC-1 | `products/kith` | A | `products/kith/fe-review/DESIGN.md` | #146 |
| AC-2 | `platform/dim-gate` | A | `platform/dim-gate/fe-review/DESIGN.md` | #147 |
| AC-3 | `products/hai-taskboard` | A | `products/hai-taskboard/fe-review/DESIGN.md` | #148 |
| AC-4 | `platform/agent-platform` | A | `platform/agent-platform/fe-review/DESIGN.md` | #149 |
| AC-5 | `apps/cms-scaffold` | A | `apps/cms-scaffold/fe-review/DESIGN.md` | #150 |
| AC-6 | `platform/ice-maker` | A | `platform/ice-maker/fe-review/DESIGN.md` | #151 |
| AC-7 | `specs/fleet` | B | `specs/fleet/fe-review/DESIGN.md`（不得改變對外契約） | #152 |
| AC-8 | `systems/ojbquay` | C | `systems/ojbquay/fe-review/DESIGN.md` | #153 |
| AC-9 | `products/goku` | C | `products/goku/fe-review/DESIGN.md` | #154 |
| AC-10 | `products/phark` | C | `products/phark/fe-review/DESIGN.md` | #155 |
| AC-11 | `apps/flowshot` ＋ `apps/loom`（同一份設計） | C | `apps/flowshot/fe-review/DESIGN.md` | #156 |
| AC-12 | `gateways/pokercase` | C | `gateways/pokercase/fe-review/DESIGN.md` | #157 |
| AC-13 | `systems/clarkq` | C | `systems/clarkq/fe-review/DESIGN.md` | #158 |
| AC-14 | `platform/fanzloud` | C | `platform/fanzloud/fe-review/DESIGN.md` | #159 |

## 不做

- 不改元件程式碼、測試、依賴或 CI，不啟動 UI，不跑 `capture.mjs`（DESIGN-PROMPT「不要做」）。
- D 檔（`apps/cloudform`、`labs/aweshore`、`tools/streaming-converter`）不寫設計。
- C 檔只做前端相關設計，不加新功能、不做 major 升級（PORTFOLIO「休眠」一節的 fe-review 例外）。
- 不把「待擁有者決定」改成「已決定」。

## 驗收條件

AC-1～AC-14 可自動檢查：`python3 docs/fe-review/check_design.py`（每個 AC 輸出一列）。每條的形式都是：

- **Given** 該單位的 `REVIEW.md` 在第 1 輪
- **When** 它的設計 PR 合併到 main
- **Then** 上表的交付物存在，而且有模板的七個二級標題：目標、依據、不做的事、修改項目、啟動方式、第 3 輪驗收、開放問題。

| AC | Given | When | Then |
| --- | --- | --- | --- |
| AC-15 | 每份設計都列出「需要擁有者確認的假設」 | owner 讀過設計 | owner 合併該設計 PR，即代表確認假設。**無法自動化，由 owner 確認** |

## 鎖定前實跑（2026-10-22，newclear main@f9fce6e）

```text
$ python3 docs/fe-review/check_design.py
AC-1   products/kith            PASS
AC-2   platform/dim-gate        PASS
AC-3   products/hai-taskboard   PASS
AC-4   platform/agent-platform  PASS
AC-5   apps/cms-scaffold        PASS
AC-6   platform/ice-maker       PASS
AC-7   specs/fleet              PASS
AC-8   systems/ojbquay          FAIL  no systems/ojbquay/fe-review/DESIGN.md
AC-9   products/goku            FAIL  no products/goku/fe-review/DESIGN.md
AC-10  products/phark           FAIL  no products/phark/fe-review/DESIGN.md
AC-11  apps/flowshot            FAIL  no apps/flowshot/fe-review/DESIGN.md
AC-12  gateways/pokercase       FAIL  no gateways/pokercase/fe-review/DESIGN.md
AC-13  systems/clarkq           FAIL  no systems/clarkq/fe-review/DESIGN.md
AC-14  platform/fanzloud        FAIL  no platform/fanzloud/fe-review/DESIGN.md
exit 1
```

AC-1～AC-7 已由先前合併的設計 PR 滿足（issue #146–#152 已關閉）。剩 C 檔七個（#153–#159）與它們的 AC-15。Python 3.13，只用標準庫。

## 合併與回報

設計 PR 依 DESIGN-PROMPT：一個單位一個 PR（flowshot＋loom 合一個），寫 `Refs #<issue>`，由擁有者合併並關 issue。本 SDD 的修改要 owner 同意（desk 運作方法 §6）。
