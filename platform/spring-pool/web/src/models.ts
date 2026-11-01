import type { AuthEnvironment } from "./auth.ts";
export type Bindings = AuthEnvironment & {
  API: Fetcher;
  BUILD_REVISION?: string;
};
export type Variables = {
  actor: string;
  local: boolean;
  csrf: string;
  form: FormData;
};
export type AppEnv = { Bindings: Bindings; Variables: Variables };
export type Issue = { field: string; issue?: string; message?: string };
export type Failure = {
  code: string;
  message: string;
  current_revision?: number;
  details?: Issue[];
};
export type Choice = {
  id: number;
  revision: number;
  title: string;
  archived_at?: string | null;
};
export type Step = {
  script_id: string | number;
  script_revision: string | number;
  instruction: string;
  script_title?: string;
  script_archived?: boolean;
  body?: string;
};
export type Entity = {
  id: number;
  revision: number;
  title: string;
  description: string;
  tags?: string[];
  language?: string;
  body?: string;
  byte_size?: number;
  steps?: Step[];
  step_count?: number;
  updated_at?: string;
  created_at?: string;
  created_by?: string;
  archived_at?: string | null;
  script_archived_at?: string | null;
  runbook_archived_at?: string | null;
};
export type Draft = {
  title: string;
  description: string;
  tags: string;
  language: string;
  body: string;
  expected_revision: string;
  steps: Step[];
  fileNotice?: string;
};
export type Kind = "scripts" | "runbooks";
export type PageData<T> = {
  items: T[];
  next_before_id?: number | null;
  next_before_revision?: number | null;
};
