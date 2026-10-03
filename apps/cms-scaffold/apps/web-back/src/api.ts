import { createCmsClient } from "@cms/api";

export const api = createCmsClient({ baseUrl: import.meta.env.VITE_API_BASE || "http://localhost:8080" });
