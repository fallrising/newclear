export type QuotaClass = "api_key" | "operator_personal";

/** GET /api/me 與 POST /api/auth/login 的 member（worker/index.ts publicMember）。 */
export type Me = {
  id: string;
  kind: "human" | "agent";
  handle: string;
  display_name: string;
  capabilities_json: string;
  quota_class: QuotaClass;
  is_operator: 0 | 1;
};

export type LoginRequest = { handle: string; password: string };
export type LoginResponse = { ok: true; member: Me };
export type LogoutResponse = { ok: true };
export type CsrfResponse = { csrf: string };
export type ApiErrorBody = { error: { code: string; message: string } };
