import type { zhTW } from "./zh-TW";

export const en = {
  "app.loading": "Loading…",
  "app.name": "Kith",
  "app.shell.logout": "Sign out",
  "auth.login.handle": "Handle",
  "auth.login.invalidCredentials": "Incorrect handle or password.",
  "auth.login.password": "Password",
  "auth.login.submit": "Sign in",
  "auth.login.submitting": "Signing in…",
  "auth.login.subtitle": "Sign in to continue to Kith",
  "auth.login.title": "Welcome back",
  "error.boundary.reload": "Reload",
  "error.boundary.title": "Something went wrong on this screen",
  "error.code.network_error": "Can't reach the server. Try again shortly.",
  "error.code.unauthorized": "Your session has expired. Sign in again.",
  "error.code.unknown": "Something went wrong. Try again.",
  "error.retry": "Retry",
  "home.greeting": "Hi, {name}",
  "home.placeholder.body": "Rooms and conversations arrive in the next version.",
  "notFound.home": "Back to home",
  "notFound.title": "Page not found",
} satisfies Record<keyof typeof zhTW, string>;
