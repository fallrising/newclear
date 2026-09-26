// @cms/api/public — the only entry point web-front may import (01 §4.1, surface-front AC-08).
// It must not import work.ts or admin.ts, directly or indirectly.
import { authApi } from "./auth";
import { createTransport, type TransportOptions } from "./core";
import { publicApi } from "./public";

export { ApiError, isApiError, type ApiErrorCode } from "./errors";
export { keys, type PublicListParams } from "./keys";
export { publicQueries, type PublicApi } from "./public";
export type { AuthApi } from "./auth";
export type { ErrorCode, LoginResponse, MediaAsset, Me, PublicEntry, PublicEntryPage, Surface } from "./schema";

export function createFrontClient(options: TransportOptions) {
  const transport = createTransport(options);
  return { url: transport.url, auth: authApi(transport), public: publicApi(transport) };
}

export type FrontClient = ReturnType<typeof createFrontClient>;
