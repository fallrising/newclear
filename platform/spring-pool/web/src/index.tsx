import { Hono, type Context } from "hono";
import type { Child } from "hono/jsx";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { authenticate } from "./auth.ts";
import { csrfForRequest, verifyCsrf } from "./csrf.ts";
import type {
  AppEnv,
  Choice,
  Draft,
  Entity,
  Failure,
  Kind,
  PageData,
  Step,
} from "./models.ts";
import { Layout, Editor, Detail, Listing, Errors } from "./views.tsx";
import { css, js } from "./assets.ts";

type C = Context<AppEnv>;
const app = new Hono<AppEnv>();
const security = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};
function page(
  c: C,
  title: string,
  children: Child,
  status: ContentfulStatusCode = 200,
) {
  return c.html(
    <Layout title={title} actor={c.get("actor")} local={c.get("local")}>
      {children}
    </Layout>,
    status,
  );
}
function problem(c: C, status: ContentfulStatusCode, message: string) {
  return page(
    c,
    message,
    <p>
      <a href="/scripts">Return to scripts</a>
    </p>,
    status,
  );
}
class ApiError extends Error {
  status: number;
  failure: Failure;
  constructor(status: number, failure: Failure) {
    super(failure.message);
    this.status = status;
    this.failure = failure;
  }
}
async function api(c: C, path: string, method = "GET", data?: unknown) {
  // Only route-owned paths reach this helper. Never pass a browser URL or headers.
  const headers = new Headers({
    Accept: "application/json",
    "X-Spring-Pool-Actor": c.get("actor"),
  });
  if (data !== undefined)
    headers.set("Content-Type", "application/json; charset=utf-8");
  let response: Response;
  try {
    response = await c.env.API.fetch(
      new Request(`https://api.internal${path}`, {
        method,
        headers,
        body: data === undefined ? undefined : JSON.stringify(data),
        redirect: "manual",
      }),
    );
  } catch {
    throw new ApiError(502, {
      code: "unavailable",
      message: "API unavailable",
    });
  }
  if (!response.ok) {
    if (response.status >= 500)
      throw new ApiError(502, {
        code: "unavailable",
        message: "API unavailable",
      });
    if (response.status === 401)
      throw new ApiError(500, {
        code: "internal",
        message: "Request could not be completed.",
      });
    let failure: Failure;
    try {
      failure = ((await response.json()) as { error: Failure }).error;
    } catch {
      throw new ApiError(502, {
        code: "unavailable",
        message: "API unavailable",
      });
    }
    throw new ApiError(response.status, failure);
  }
  return response;
}
async function json<T>(
  c: C,
  path: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  return (await (await api(c, path, method, data)).json()) as T;
}
function validId(value: string) {
  return /^[1-9][0-9]{0,15}$/.test(value);
}
function field(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
function emptyDraft(): Draft {
  return {
    title: "",
    description: "",
    tags: "",
    language: "bash",
    body: "",
    expected_revision: "",
    steps: [],
  };
}
function fromEntity(entity: Entity): Draft {
  return {
    title: entity.title,
    description: entity.description,
    tags: entity.tags?.join(", ") ?? "",
    language: entity.language ?? "bash",
    body: entity.body ?? "",
    expected_revision: String(entity.revision),
    steps: entity.steps ?? [],
  };
}
function fromForm(form: FormData): Draft {
  const draft = emptyDraft();
  for (const name of [
    "title",
    "description",
    "tags",
    "language",
    "body",
    "expected_revision",
  ] as const)
    draft[name] = field(form, name);
  draft.body = draft.body.replace(/\r\n/g, "\n");
  draft.description = draft.description.replace(/\r\n/g, "\n");
  const indexes = new Set<number>();
  for (const name of form.keys()) {
    const match =
      /^steps\[(\d+)\]\.(script_id|script_revision|instruction)$/.exec(name);
    if (match) indexes.add(Number(match[1]));
  }
  draft.steps = [...indexes]
    .sort((a, b) => a - b)
    .map((i) => ({
      script_id: field(form, `steps[${i}].script_id`),
      script_revision: field(form, `steps[${i}].script_revision`),
      instruction: field(form, `steps[${i}].instruction`).replace(
        /\r\n/g,
        "\n",
      ),
    }));
  return draft;
}
function submittedChoices(form: FormData): Choice[] {
  try {
    const parsed: unknown = JSON.parse(field(form, "script_options"));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (value): value is Choice =>
          value &&
          Number.isSafeInteger(value.id) &&
          value.id > 0 &&
          Number.isSafeInteger(value.revision) &&
          value.revision > 0 &&
          typeof value.title === "string" &&
          value.title.length <= 400 &&
          (value.archived_at == null || typeof value.archived_at === "string"),
      )
      .slice(0, 130);
  } catch {
    return [];
  }
}
function newStep(choices: Choice[]): Step {
  return {
    script_id: choices[0]?.id ?? "",
    script_revision: choices[0]?.revision ?? 1,
    instruction: "",
  };
}
function editor(
  c: C,
  kind: Kind,
  draft: Draft,
  id?: string,
  choices: Choice[] = [],
  failure?: Failure,
  status: ContentfulStatusCode = 200,
) {
  return page(
    c,
    `${id ? "Edit" : "New"} ${kind === "scripts" ? "script" : "runbook"}`,
    <Editor
      kind={kind}
      draft={draft}
      id={id}
      choices={choices}
      error={failure}
      csrf={c.get("csrf")}
    />,
    status,
  );
}
function queryFor(c: C, names: string[]) {
  const query = new URLSearchParams();
  for (const name of names) {
    const value = c.req.query(name);
    if (value) query.set(name, value);
  }
  return query;
}
function nextLink(c: C, value: number | null | undefined, name = "before_id") {
  if (!value) return null;
  const query = new URLSearchParams(new URL(c.req.url).search);
  query.set(name, String(value));
  return (
    <p>
      <a href={`${c.req.path}?${query}`}>Older entries</a>
    </p>
  );
}

app.use("*", async (c, next) => {
  for (const [name, value] of Object.entries(security)) c.header(name, value);
  const auth = await authenticate(c.req.raw, c.env);
  if (!auth.ok) return problem(c, auth.status, auth.message);
  c.set("actor", auth.actor);
  c.set("local", auth.local);
  const csrf = csrfForRequest(
    c.req.raw,
    auth.local && new URL(c.req.url).protocol === "http:",
  );
  c.set("csrf", csrf.token);
  if (csrf.cookie) c.header("Set-Cookie", csrf.cookie);
  await next();
  // A streaming handler may return its own Response; apply the boundary headers
  // after it finishes as well, including errors handled by Hono.
  for (const [name, value] of Object.entries(security)) {
    if (
      name === "Cache-Control" &&
      c.res.status === 200 &&
      ["/assets/app.css", "/assets/app.js"].includes(c.req.path)
    )
      continue;
    c.header(name, value);
  }
  if (csrf.cookie) c.header("Set-Cookie", csrf.cookie);
});
app.use("*", async (c, next) => {
  if (c.req.method !== "POST") return next();
  if (c.req.header("origin") !== new URL(c.req.url).origin)
    return problem(c, 403, "Request rejected (CSRF).");
  const max = 262144;
  if (Number(c.req.header("content-length")) > max)
    return problem(c, 413, "Request too large.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = c.req.raw.body?.getReader();
  if (reader) {
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > max) {
          await reader.cancel();
          return problem(c, 413, "Request too large.");
        }
        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  let form: FormData;
  try {
    form = await new Response(bytes, {
      headers: { "Content-Type": c.req.header("content-type") ?? "" },
    }).formData();
  } catch {
    return problem(c, 400, "Invalid form.");
  }
  const localCookie = c.get("local") && new URL(c.req.url).protocol === "http:";
  if (!verifyCsrf(c.req.raw, form.get("csrf"), localCookie))
    return problem(c, 403, "Request rejected (CSRF).");
  c.set("form", form);
  await next();
});
app.get("/", (c) => c.redirect("/scripts", 302));
app.get("/assets/app.css", (c) => {
  c.header("Cache-Control", "public, max-age=300");
  return c.body(css, 200, { "Content-Type": "text/css; charset=utf-8" });
});
app.get("/assets/app.js", (c) => {
  c.header("Cache-Control", "public, max-age=300");
  return c.body(js, 200, { "Content-Type": "text/javascript; charset=utf-8" });
});
app.get("/assets/icon.svg", (c) =>
  c.body(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="4" fill="#075e59"/><path d="M9 10h14M9 16h14M9 22h9" stroke="white" stroke-width="2"/></svg>',
    200,
    { "Content-Type": "image/svg+xml" },
  ),
);
app.get("/healthz", async (c) => {
  try {
    const health = await json<{
      status: string;
      service: string;
      build: string;
      database: string;
    }>(c, "/v1/health");
    return c.json(
      {
        status: health.status,
        service: "spring-pool-web",
        build: c.env.BUILD_REVISION || "dev",
        api: {
          status: health.status,
          service: health.service,
          build: health.build,
          database: health.database,
        },
      },
      health.status === "ok" ? 200 : 503,
    );
  } catch {
    return c.json(
      {
        status: "degraded",
        service: "spring-pool-web",
        build: c.env.BUILD_REVISION || "dev",
        api: { status: "unavailable" },
      },
      503,
    );
  }
});
for (const kind of ["scripts", "runbooks"] as const) {
  const base = `/${kind}`;
  app.get(base, async (c) => {
    const query = queryFor(c, [
      "q",
      "archived",
      "before_id",
      ...(kind === "scripts" ? ["tag"] : []),
    ]);
    const data = await json<PageData<Entity>>(c, `/v1/${kind}?${query}`);
    return page(
      c,
      kind === "scripts" ? "Scripts" : "Runbooks",
      <>
        <Listing kind={kind} items={data.items} query={query} />
        {nextLink(c, data.next_before_id)}
      </>,
    );
  });
  app.get(`${base}/new`, async (c) => {
    const choices =
      kind === "runbooks"
        ? (await json<PageData<Choice>>(c, "/v1/scripts?limit=100")).items
        : [];
    const draft = emptyDraft();
    if (kind === "runbooks") draft.steps = [newStep(choices)];
    return editor(c, kind, draft, undefined, choices);
  });
  app.get(`${base}/:id/edit`, async (c) => {
    const id = c.req.param("id");
    if (!validId(id)) return problem(c, 404, "Not found.");
    const entity = await json<Entity>(c, `/v1/${kind}/${id}`);
    if (entity.archived_at)
      return problem(
        c,
        409,
        "This item was archived. Its history remains available.",
      );
    const choices =
      kind === "runbooks"
        ? (await json<PageData<Choice>>(c, "/v1/scripts?limit=100")).items
        : [];
    // Keep pins outside the active picker, including archived scripts, across draft posts.
    for (const step of entity.steps ?? [])
      if (
        !choices.some((choice) => String(choice.id) === String(step.script_id))
      )
        choices.push({
          id: Number(step.script_id),
          revision: Number(step.script_revision),
          title: step.script_title ?? `Script ${step.script_id}`,
          archived_at: step.script_archived ? "archived" : null,
        });
    return editor(c, kind, fromEntity(entity), id, choices);
  });
  async function save(c: C, id?: string) {
    if (id && !validId(id)) return problem(c, 404, "Not found.");
    const form = c.get("form"),
      draft = fromForm(form),
      choices = submittedChoices(form);
    const action = field(form, "action") || "save";
    if (kind === "runbooks" && action !== "save") {
      if (action === "add_step" && draft.steps.length < 30)
        draft.steps.push(newStep(choices));
      else if (/^(up|down|remove):\d+$/.test(action)) {
        const [operation, rawIndex] = action.split(":"),
          index = Number(rawIndex);
        if (index < draft.steps.length) {
          if (operation === "remove") draft.steps.splice(index, 1);
          else {
            const target = index + (operation === "up" ? -1 : 1);
            if (target >= 0 && target < draft.steps.length)
              [draft.steps[index], draft.steps[target]] = [
                draft.steps[target],
                draft.steps[index],
              ];
          }
        }
      } else if (action !== "add_step")
        return problem(c, 400, "Invalid step action.");
      return editor(c, kind, draft, id, choices);
    }
    let failure: Failure | undefined;
    let status: ContentfulStatusCode = 422;
    if (kind === "scripts") {
      const upload = form.get("file");
      if (upload && typeof upload !== "string" && upload.size > 0) {
        draft.fileNotice =
          "Browsers cannot refill file inputs. Re-select the file before saving, or use the decoded text below.";
        if (draft.body)
          failure = {
            code: "validation_failed",
            message: "Provide pasted text or a file, not both.",
            details: [{ field: "file", message: "Choose one source." }],
          };
        else if (upload.size > 65536) {
          status = 413;
          failure = {
            code: "script_too_large",
            message: "Script content exceeds 65 536 bytes.",
            details: [
              { field: "file", message: "Choose a file up to 64 KiB." },
            ],
          };
        } else {
          try {
            draft.body = new TextDecoder("utf-8", {
              fatal: true,
              ignoreBOM: true,
            }).decode(await upload.arrayBuffer());
          } catch {
            failure = {
              code: "validation_failed",
              message: "File is not valid UTF-8.",
              details: [{ field: "file", message: "Choose a UTF-8 file." }],
            };
          }
        }
      }
      if (!failure && new TextEncoder().encode(draft.body).byteLength > 65536) {
        status = 413;
        failure = {
          code: "script_too_large",
          message: "Script content exceeds 65 536 bytes.",
          details: [{ field: "body", message: "Maximum 64 KiB." }],
        };
      }
    }
    if (failure) return editor(c, kind, draft, id, choices, failure, status);
    const data =
      kind === "scripts"
        ? {
            title: draft.title,
            description: draft.description,
            tags: draft.tags
              .split(",")
              .map((tag) => tag.trim().toLowerCase())
              .filter(Boolean),
            language: draft.language,
            body: draft.body,
          }
        : {
            title: draft.title,
            description: draft.description,
            steps: draft.steps.map((step) => ({
              script_id: Number(step.script_id),
              script_revision: Number(step.script_revision),
              instruction: step.instruction,
            })),
          };
    try {
      const result = await json<Entity>(
        c,
        `/v1/${kind}${id ? `/${id}` : ""}`,
        id ? "PUT" : "POST",
        {
          ...data,
          ...(id ? { expected_revision: Number(draft.expected_revision) } : {}),
        },
      );
      return c.redirect(`/${kind}/${result.id}`, 303);
    } catch (error) {
      if (error instanceof ApiError && [409, 413, 422].includes(error.status))
        return editor(
          c,
          kind,
          draft,
          id,
          choices,
          error.failure,
          error.status as ContentfulStatusCode,
        );
      throw error;
    }
  }
  app.post(base, (c) => save(c));
  app.post(`${base}/:id`, (c) => save(c, c.req.param("id")));
  app.post(`${base}/:id/archive`, async (c) => {
    const id = c.req.param("id");
    if (!validId(id)) return problem(c, 404, "Not found.");
    try {
      await api(c, `/v1/${kind}/${id}/archive`, "POST", {
        expected_revision: Number(field(c.get("form"), "expected_revision")),
      });
      return c.redirect(`/${kind}/${id}`, 303);
    } catch (error) {
      if (error instanceof ApiError && [409, 413, 422].includes(error.status))
        return page(
          c,
          "Archive not saved",
          <Errors error={error.failure} current={`/${kind}/${id}`} />,
          error.status as ContentfulStatusCode,
        );
      throw error;
    }
  });
  app.get(`${base}/:id/revisions`, async (c) => {
    const id = c.req.param("id");
    if (!validId(id)) return problem(c, 404, "Not found.");
    const data = await json<PageData<Entity>>(
      c,
      `/v1/${kind}/${id}/revisions?${queryFor(c, ["before_revision"])}`,
    );
    return page(
      c,
      "Revision history",
      <>
        <p>
          <a href={`${base}/${id}`}>Current revision</a>
        </p>
        <table class="index">
          <thead>
            <tr>
              <th scope="col">Revision</th>
              <th scope="col">Saved</th>
              <th scope="col">Actor</th>
              <th scope="col">{kind === "scripts" ? "Bytes" : "Steps"}</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((item) => (
              <tr>
                <td>
                  <a href={`${base}/${id}/revisions/${item.revision}`}>
                    Revision {item.revision}
                  </a>
                </td>
                <td>{item.created_at}</td>
                <td>{item.created_by}</td>
                <td>{kind === "scripts" ? item.byte_size : item.step_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {nextLink(c, data.next_before_revision, "before_revision")}
      </>,
    );
  });
  async function detail(c: C, historical: boolean) {
    const id = c.req.param("id") ?? "",
      rev = c.req.param("rev") ?? "";
    if (!validId(id) || (historical && !validId(rev)))
      return problem(c, 404, "Not found.");
    const entity = await json<Entity>(
      c,
      `/v1/${kind}/${id}${historical ? `/revisions/${rev}` : ""}`,
    );
    const headRevision = historical
      ? (await json<Entity>(c, `/v1/${kind}/${id}`)).revision
      : entity.revision;
    if (kind === "runbooks")
      entity.steps = await Promise.all(
        (entity.steps ?? []).map(async (step) => ({
          ...step,
          body: (
            await json<Entity>(
              c,
              `/v1/scripts/${step.script_id}/revisions/${step.script_revision}`,
            )
          ).body,
        })),
      );
    return page(
      c,
      entity.title,
      <Detail
        kind={kind}
        entity={entity}
        id={id}
        csrf={c.get("csrf")}
        historical={historical}
        headRevision={headRevision}
      />,
    );
  }
  app.get(`${base}/:id/revisions/:rev`, (c) => detail(c, true));
  app.get(`${base}/:id`, (c) => detail(c, false));
}
app.get("/runbooks/:id/revisions/:rev/export.md", async (c) => {
  const id = c.req.param("id"),
    rev = c.req.param("rev");
  if (!validId(id) || !validId(rev)) return problem(c, 404, "Not found.");
  const response = await api(c, `/v1/runbooks/${id}/revisions/${rev}/export`);
  return new Response(response.body, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="runbook-${id}-r${rev}.md"`,
    },
  });
});
app.get("/audit", async (c) => {
  type Event = {
    id: number;
    occurred_at: string;
    actor: string;
    action: string;
    entity_type: "script" | "runbook";
    entity_id: number;
    revision: number;
  };
  const data = await json<PageData<Event>>(
    c,
    `/v1/audit?${queryFor(c, ["before_id"])}`,
  );
  return page(
    c,
    "Audit",
    <>
      {data.items.length === 0 ? (
        <p>No activity recorded yet.</p>
      ) : (
        <table class="index">
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Actor</th>
              <th scope="col">Action</th>
              <th scope="col">Entity / revision</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((event) => (
              <tr>
                <td>{event.occurred_at}</td>
                <td>{event.actor}</td>
                <td>{event.action}</td>
                <td>
                  <a
                    href={`/${event.entity_type === "script" ? "scripts" : "runbooks"}/${event.entity_id}/revisions/${event.revision}`}
                  >
                    {event.entity_type} {event.entity_id} · r{event.revision}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {nextLink(c, data.next_before_id)}
    </>,
  );
});
app.notFound((c) => problem(c, 404, "Not found."));
app.onError((error, c) =>
  error instanceof ApiError
    ? problem(
        c,
        error.status as ContentfulStatusCode,
        error.status === 404 ? "Not found." : error.failure.message,
      )
    : problem(c, 500, "Request could not be completed."),
);
export default app;
