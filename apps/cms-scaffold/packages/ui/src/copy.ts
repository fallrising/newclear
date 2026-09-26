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
} as const;

export type UiCopyKey = keyof typeof uiCopy;
