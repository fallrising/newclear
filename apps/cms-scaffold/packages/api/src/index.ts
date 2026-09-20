export type Surface = "front" | "back" | "admin";

export type ApiError = { code: string; message: string };

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function createClient(options: { base?: string; surface: Surface }) {
  const base = (options.base || "http://localhost:8080").replace(/\/$/, "");
  let csrf = "";

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    const method = (init.method || "GET").toUpperCase();
    if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (csrf && method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      headers.set("X-CSRF-Token", csrf);
    }
    const res = await fetch(base + path, { ...init, method, headers, credentials: "include" });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json && typeof json === "object" && json.csrfToken) csrf = json.csrfToken;
    if (!res.ok) {
      const err = json?.error || {};
      throw new ApiRequestError(res.status, err.code || "ERROR", err.message || res.statusText);
    }
    return json as T;
  }

  return {
    base,
    surface: options.surface,
    async csrf() {
      const body = await request<{ csrfToken: string }>("/api/v1/auth/csrf");
      csrf = body.csrfToken;
      return csrf;
    },
    login(username: string, password: string) {
      return request<Me>("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
    },
    logout() {
      return request<void>("/api/v1/auth/logout", { method: "POST" });
    },
    me() {
      return request<Me>("/api/v1/auth/me");
    },
    publicTypes() {
      return request<{ items: ContentType[] }>("/api/v1/public/content-types");
    },
    publicEntries(type: string, query: Record<string, string> = {}) {
      const q = new URLSearchParams(query).toString();
      return request<{ items: PublicEntry[] }>(`/api/v1/public/content-types/${type}/entries${q ? `?${q}` : ""}`);
    },
    publicBySlug(type: string, slug: string) {
      return request<PublicEntry>(`/api/v1/public/content-types/${type}/slugs/${encodeURIComponent(slug)}`);
    },
    publicById(type: string, id: string) {
      return request<PublicEntry>(`/api/v1/public/content-types/${type}/entries/${id}`);
    },
    types() {
      return request<{ items: ContentType[] }>("/api/v1/content-types");
    },
    type(type: string) {
      return request<ContentType>(`/api/v1/content-types/${type}`);
    },
    entries(type: string, query: string | Record<string, string> = {}) {
      const params = typeof query === "string" ? { state: query } : query;
      const q = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value) q.set(key, value);
      });
      const suffix = q.toString();
      return request<{ items: WorkEntry[] }>(`/api/v1/content-types/${type}/entries${suffix ? `?${suffix}` : ""}`);
    },
    createEntry(type: string, body: { slug?: string; payload: Record<string, unknown> }) {
      return request<WorkEntry>(`/api/v1/content-types/${type}/entries`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    getEntry(id: string) {
      return request<WorkEntry>(`/api/v1/entries/${id}`);
    },
    patchEntry(id: string, body: { slug?: string; payload?: Record<string, unknown>; version?: number }) {
      return request<WorkEntry>(`/api/v1/entries/${id}`, { method: "PATCH", body: JSON.stringify(body) });
    },
    publish(id: string) {
      return request<WorkEntry>(`/api/v1/entries/${id}/publish`, { method: "POST" });
    },
    unpublish(id: string) {
      return request<WorkEntry>(`/api/v1/entries/${id}/unpublish`, { method: "POST" });
    },
    archive(id: string) {
      return request<WorkEntry>(`/api/v1/entries/${id}/archive`, { method: "POST" });
    },
    async upload(file: File, title?: string) {
      const form = new FormData();
      form.append("file", file);
      if (title) form.append("title", title);
      return request<MediaAsset>("/api/v1/media", { method: "POST", body: form });
    },
    principals() {
      return request<{ items: Principal[] }>("/api/v1/principals");
    },
    adminTypes() {
      return request<{ items: ContentType[] }>("/api/v1/admin/content-types");
    },
    enableType(key: string) {
      return request(`/api/v1/admin/content-types/${key}/enable`, { method: "POST" });
    },
    disableType(key: string) {
      return request(`/api/v1/admin/content-types/${key}/disable`, { method: "POST" });
    },
    mediaQuota() {
      return request<Record<string, number>>("/api/v1/media/quota");
    },
  };
}

export type CmsClient = ReturnType<typeof createClient>;

export type Me = {
  principal: { id: string; username: string; displayName: string; status: string };
  roles: { code: string; contentTypeCodes: string[] }[];
  surfaces: { front: boolean; back: boolean; admin: boolean };
  csrfToken?: string;
};

export type ContentType = {
  key: string;
  displayName: string;
  pluralDisplayName?: string;
  titleField?: string;
  slugPolicy?: string;
  enabled?: boolean;
  fields?: { key: string; type: string; required?: boolean; refTarget?: string; enumValues?: string[] }[];
};

export type PublicEntry = {
  id: string;
  contentType: string;
  slug?: string;
  title?: string;
  payload: Record<string, unknown>;
  publishedAt?: string;
};

export type WorkEntry = PublicEntry & {
  publicationState: string;
  version: number;
  dirty?: boolean;
  updatedAt?: string;
};

export type Principal = {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  status: string;
};

export type MediaAsset = {
  id: string;
  title: string;
  variants?: Record<string, { url: string; width?: number; height?: number }>;
};
