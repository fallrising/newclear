// User-visible strings of @cms/ui (zh-Hant). Key rule: waves/W0.md §4.6.
export const uiCopy = {
  "ui.skipLink": "跳到主要內容",
  "ui.nav.open": "開啟選單",
  "ui.nav.label": "主要導覽",
  "ui.account.menu": "帳號選單",
  "ui.account.signOut": "登出",
  "ui.actions.more": "更多動作",
  "ui.error.title": "無法載入",
  "ui.error.body": "請稍後再試。",
  "ui.error.retry": "重試",
  "ui.loading": "載入中",
  "ui.status.draft": "草稿",
  "ui.status.published": "已發布",
  "ui.status.archived": "已封存",
  "ui.status.dirty": "有未發布的變更",
  "ui.index.search": "搜尋標題",
  "ui.index.sort": "排序",
  "ui.index.clear": "清除篩選",
  "ui.index.filterAll": "{label}：全部",
  "ui.pagination.total": "共 {total} 筆",
  "ui.pagination.page": "第 {page} / {pages} 頁",
  "ui.pagination.previous": "上一頁",
  "ui.pagination.next": "下一頁",
  "ui.pagination.size": "每頁筆數",
  "ui.save.title": "未儲存的變更",
  "ui.save.save": "儲存",
  "ui.save.saving": "儲存中…",
  "ui.save.discard": "捨棄",
  "ui.leave.title": "離開這個頁面？",
  "ui.leave.body": "你有未儲存的變更，離開後會遺失。",
  "ui.leave.stay": "留在此頁",
  "ui.leave.leave": "捨棄並離開",
} as const;

export type UiCopyKey = keyof typeof uiCopy;

/** Replaces `{name}` placeholders in a copy string. The only formatting helper; used for counts and page numbers. */
export function fill(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ""));
}
