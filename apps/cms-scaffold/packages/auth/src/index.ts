// @cms/auth — session, route guard, login page and return-path allowlist shared by the three apps (E-01).
export { authCopy, type AuthCopyKey } from "./copy";
export { createAppQueryClient, shouldRetry } from "./query-client";
export { LoginPage, type LoginPageProps } from "./login-page";
export { RequireSurface, type RequireSurfaceProps } from "./require-surface";
export { safeReturnTo } from "./return-to";
export { SessionProvider, useOptionalSession, useSession, type Session, type SessionStatus } from "./session";
