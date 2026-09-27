import type { Transport } from "./core";
import type { LoginResponse, Me } from "./schema";

export function authApi(t: Transport) {
  return {
    async login(username: string, password: string): Promise<LoginResponse> {
      const body = await t.call(() => t.client.POST("/api/v1/auth/login", { body: { username, password } }));
      t.setCsrfToken(body.csrfToken);
      return body;
    },
    async logout(): Promise<void> {
      await t.call(() => t.client.POST("/api/v1/auth/logout", {}));
      t.setCsrfToken(null);
    },
    me(signal?: AbortSignal): Promise<Me> {
      return t.call(() => t.client.GET("/api/v1/auth/me", { signal }));
    },
  };
}

export type AuthApi = ReturnType<typeof authApi>;
