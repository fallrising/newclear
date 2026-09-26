// @cms/api — full client for web-back and web-admin. web-front imports @cms/api/public only.
import { adminApi } from "./admin";
import { authApi } from "./auth";
import { createTransport, type TransportOptions } from "./core";
import { publicApi } from "./public";
import { workApi } from "./work";

export { ApiError, errorFromBody, isApiError, type ApiErrorCode, type ClientErrorCode } from "./errors";
export type { Transport, TransportOptions } from "./core";
export { keys, type PublicListParams, type WorkListParams } from "./keys";
export { publicQueries, type PublicApi } from "./public";
export { workQueries, type WorkApi } from "./work";
export { adminQueries, type AdminApi } from "./admin";
export type { AuthApi } from "./auth";
export type * from "./schema";

export function createCmsClient(options: TransportOptions) {
  const transport = createTransport(options);
  return {
    url: transport.url,
    auth: authApi(transport),
    public: publicApi(transport),
    work: workApi(transport),
    admin: adminApi(transport),
  };
}

export type CmsClient = ReturnType<typeof createCmsClient>;
