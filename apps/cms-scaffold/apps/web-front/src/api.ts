import { createFrontClient } from "@cms/api/public";

export const api = createFrontClient({ baseUrl: import.meta.env.VITE_API_BASE || "http://localhost:8080" });
