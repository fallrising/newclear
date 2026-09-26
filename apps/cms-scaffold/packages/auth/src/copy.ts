// User-visible strings of @cms/auth (zh-Hant). Key rule: waves/W0.md §4.6.
export const authCopy = {
  "auth.login.username": "帳號",
  "auth.login.password": "密碼",
  "auth.login.submit": "登入",
  "auth.login.submitting": "登入中…",
  "auth.login.error.credentials": "帳號或密碼錯誤。",
  "auth.login.error.locked": "帳號已暫時鎖定，請稍後再試或聯絡管理員。",
  "auth.login.error.disabled": "帳號已停用，請聯絡管理員。",
  "auth.login.error.required": "請輸入帳號與密碼。",
  "auth.login.error.generic": "目前無法登入，請稍後再試。",
  "auth.login.error.noSurface": "這個帳號不能使用這個作業台。",
} as const;

export type AuthCopyKey = keyof typeof authCopy;
