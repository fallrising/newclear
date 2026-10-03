// Query key factory (01 §4.3). Every useQuery and invalidateQueries uses these; never write a key literal.
export interface PublicListParams {
  q?: string;
  page?: number;
  size?: number;
  sort?: string;
  /** Equality filters or datetime keys ending in .from / .to. */
  filter?: Record<string, string | number | boolean>;
  /** ref.<fieldKey>=<entry id> */
  ref?: Record<string, string | readonly string[]>;
}

export interface WorkListParams extends PublicListParams {
  /** Comma-separated publication states; omitted means draft,published. */
  state?: string;
  publishRequested?: boolean;
  include?: "refs";
}

export const keys = {
  auth: {
    me: () => ["auth", "me"] as const,
    expired: () => ["auth", "expired"] as const,
  },
  public: {
    all: () => ["public"] as const,
    entries: (type: string, params: PublicListParams = {}) => ["public", "entries", type, params] as const,
    allEntries: (type: string, params: PublicListParams = {}) => ["public", "entries", type, "all", params] as const,
    bySlug: (type: string, slug: string) => ["public", "bySlug", type, slug] as const,
    byId: (type: string, id: string) => ["public", "byId", type, id] as const,
  },
  types: {
    all: () => ["types"] as const,
    list: () => ["types", "list"] as const,
    detail: (type: string) => ["types", "detail", type] as const,
  },
  entries: {
    all: () => ["entries"] as const,
    lists: (type: string) => ["entries", "list", type] as const,
    list: (type: string, params: WorkListParams = {}) => ["entries", "list", type, params] as const,
    allEntries: (type: string, params: WorkListParams = {}) => ["entries", "list", type, "all", params] as const,
    detail: (id: string) => ["entries", "detail", id] as const,
    preview: (id: string) => ["entries", "preview", id] as const,
    revisions: (id: string) => ["entries", "revisions", id] as const,
  },
  media: {
    all: () => ["media"] as const,
    list: () => ["media", "list"] as const,
    quota: () => ["media", "quota"] as const,
    detail: (id: string) => ["media", "detail", id] as const,
  },
  admin: {
    types: () => ["admin", "types"] as const,
    principals: () => ["admin", "principals"] as const,
  },
};
