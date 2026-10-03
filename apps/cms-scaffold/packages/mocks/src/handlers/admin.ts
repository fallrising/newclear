import { http, HttpResponse } from "msw";
import type { AdminContentType, AdminContentTypeList, MediaQuota, PrincipalList } from "@cms/api";
import { db } from "../db";
import { mediaQuota, principals } from "../fixtures.gen";
import { canGlobal, requireAdmin, requireWork } from "../guards";
import { apiError } from "../respond";

function toggle(enabled: boolean) {
  return http.post(`*/api/v1/admin/content-types/:type/${enabled ? "enable" : "disable"}`, ({ params }) => {
    const user = requireAdmin();
    if (user instanceof Response) return user;
    const type = db.adminTypes.find((t) => t.key === params.type);
    if (!type) return apiError(404, "CONTENT_TYPE_NOT_FOUND", "Content type not found");
    type.enabled = enabled;
    return HttpResponse.json<AdminContentType>(type);
  });
}

export const adminHandlers = [
  http.get("*/api/v1/principals", () => {
    const user = requireAdmin();
    return user instanceof Response ? user : HttpResponse.json<PrincipalList>(principals);
  }),

  http.get("*/api/v1/admin/content-types", () => {
    const user = requireAdmin();
    return user instanceof Response ? user : HttpResponse.json<AdminContentTypeList>({ items: db.adminTypes });
  }),

  toggle(true),
  toggle(false),

  http.get("*/api/v1/media/quota", () => {
    const user = requireWork();
    if (user instanceof Response) return user;
    if (!canGlobal(user, "manage_media")) return apiError(403, "FORBIDDEN", "Missing permission manage_media on content type media");
    const assets = db.media;
    return HttpResponse.json<MediaQuota>({ ...mediaQuota, usedFiles: assets.length, usedBytes: assets.reduce((sum, asset) => sum + Object.values(asset.variants).reduce((bytes, variant) => bytes + (variant?.byteSize ?? 0), 0), 0) });
  }),
];
