import type { Child } from "hono/jsx";
import type { Choice, Draft, Entity, Failure, Kind } from "./models.ts";

export function Layout({
  title,
  actor,
  local,
  children,
}: {
  title: string;
  actor?: string;
  local?: boolean;
  children: Child;
}) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title} · spring-pool</title>
        <link rel="stylesheet" href="/assets/app.css" />
        <link rel="icon" href="/assets/icon.svg" type="image/svg+xml" />
        <script src="/assets/app.js" defer />
      </head>
      <body>
        <a class="skip" href="#main">
          Skip to content
        </a>
        <header class="topbar">
          <a class="brand" href="/scripts">
            spring-pool
          </a>
          <nav aria-label="Primary">
            <a href="/scripts">Scripts</a>
            <a href="/runbooks">Runbooks</a>
            <a href="/audit">Audit</a>
          </nav>
          {actor && <span class="actor">{actor}</span>}
        </header>
        {local && <div class="local">LOCAL AUTH MODE</div>}
        <main id="main">
          <h1>{title}</h1>
          {children}
        </main>
        <footer>Saved instructions. Fixed revisions.</footer>
      </body>
    </html>
  );
}
export function Errors({
  error,
  current,
}: {
  error?: Failure;
  current?: string;
}) {
  if (!error) return null;
  return (
    <section class="error" role="alert" tabindex={-1} id="errors">
      <h2>Save failed</h2>
      <p>
        {error.code === "revision_conflict" || error.code === "archived"
          ? `Not saved: this item changed (now revision ${error.current_revision ?? "unknown"}) or was archived. Review the current revision, then re-apply your changes.`
          : error.message}
      </p>
      {current && <a href={current}>Review the current revision</a>}
      <ul>
        {error.details?.map((issue) => (
          <li>
            <a
              href={`#${issue.field.startsWith("tags[") ? "tags" : issue.field}`}
            >
              {issue.field}: {issue.message ?? issue.issue ?? "Invalid value"}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
function Field({
  label,
  name,
  value,
  multiline,
  required,
  error,
  type = "text",
}: {
  label: string;
  name: string;
  value: string | number;
  multiline?: boolean;
  required?: boolean;
  error?: Failure;
  type?: string;
}) {
  const issues =
    error?.details?.filter(
      (i) =>
        i.field === name || (name === "tags" && i.field.startsWith("tags[")),
    ) ?? [];
  const attrs = {
    id: name,
    name,
    required,
    "aria-describedby": issues.length ? `${name}-error` : undefined,
    "aria-invalid": issues.length ? true : undefined,
  };
  return (
    <div class="field">
      <label for={name}>
        {label}
        {required && <span class="required"> (required)</span>}
      </label>
      {multiline ? (
        <textarea {...attrs} rows={name === "body" ? 16 : 3}>
          {"\n"}
          {value}
        </textarea>
      ) : (
        <input
          {...attrs}
          type={type}
          value={value}
          min={type === "number" ? "1" : undefined}
        />
      )}{" "}
      {issues.length > 0 && (
        <p class="field-error" id={`${name}-error`}>
          {issues
            .map((i) => i.message ?? i.issue ?? "Invalid value")
            .join(", ")}
        </p>
      )}
    </div>
  );
}
export function Editor({
  kind,
  draft,
  csrf,
  id,
  choices = [],
  error,
}: {
  kind: Kind;
  draft: Draft;
  csrf: string;
  id?: string;
  choices?: Choice[];
  error?: Failure;
}) {
  const script = kind === "scripts";
  return (
    <>
      <Errors error={error} current={id ? `/${kind}/${id}` : undefined} />
      <form
        method="post"
        action={`/${kind}${id ? `/${id}` : ""}`}
        enctype={
          script ? "multipart/form-data" : "application/x-www-form-urlencoded"
        }
        class="editor"
        data-step-editor={script ? undefined : "true"}
      >
        <input type="hidden" name="csrf" value={csrf} />
        {id && (
          <input
            type="hidden"
            name="expected_revision"
            value={draft.expected_revision}
          />
        )}
        <Field
          label="Title"
          name="title"
          value={draft.title}
          required
          error={error}
        />
        <Field
          label="Description"
          name="description"
          value={draft.description}
          multiline
          error={error}
        />
        {script ? (
          <>
            <Field label="Tags" name="tags" value={draft.tags} error={error} />
            <p class="hint">
              Comma-separated labels, for example ops, database.
            </p>
            <div class="field">
              <label for="language">
                Language <span class="required">(required)</span>
              </label>
              <select id="language" name="language" required>
                {["bash", "python", "powershell"].map((language) => (
                  <option
                    value={language}
                    selected={draft.language === language}
                  >
                    {language}
                  </option>
                ))}
                {!["bash", "python", "powershell"].includes(draft.language) && (
                  <option value={draft.language} selected>
                    {draft.language}
                  </option>
                )}
              </select>
            </div>
            <Field
              label="Script content"
              name="body"
              value={draft.body}
              multiline
              error={error}
            />
            <div class="field">
              <label for="file">Upload file</label>
              <input
                type="file"
                id="file"
                name="file"
                aria-describedby="file-help"
              />
              <p id="file-help" class="hint">
                UTF-8, up to 64 KiB. Use pasted text or a file.
              </p>
              {draft.fileNotice && <p class="hint">{draft.fileNotice}</p>}
              {error?.details
                ?.filter((i) => i.field === "file")
                .map((i) => (
                  <p class="field-error">{i.message ?? i.issue}</p>
                ))}
            </div>
          </>
        ) : (
          <>
            <input
              type="hidden"
              name="script_options"
              value={JSON.stringify(choices)}
            />
            <div data-steps id="steps">
              {draft.steps.map((step, i) => {
                const field = `steps[${i}]`;
                const missing = !choices.some(
                  (choice) => String(choice.id) === String(step.script_id),
                );
                return (
                  <fieldset data-step>
                    <legend>Step {i + 1}</legend>
                    <div class="pin-fields">
                      <div class="field">
                        <label for={`${field}.script_id`}>Script</label>
                        <select
                          required
                          id={`${field}.script_id`}
                          name={`${field}.script_id`}
                          data-script-picker
                        >
                          <option value="" selected={!step.script_id}>
                            Choose a script
                          </option>
                          {choices.map((choice) => (
                            <option
                              value={choice.id}
                              data-revision={choice.revision}
                              selected={
                                String(choice.id) === String(step.script_id)
                              }
                            >
                              {choice.title}
                              {choice.archived_at ? " (archived)" : ""}
                            </option>
                          ))}
                          {missing && step.script_id && (
                            <option value={step.script_id} selected>
                              {step.script_title ?? `Script ${step.script_id}`}
                              {step.script_archived
                                ? " (archived)"
                                : " (pinned revision)"}
                            </option>
                          )}
                        </select>
                        {error?.details
                          ?.filter(
                            (issue) => issue.field === `${field}.script_id`,
                          )
                          .map((issue) => (
                            <p class="field-error">
                              {issue.message ?? issue.issue}
                            </p>
                          ))}
                      </div>
                      <Field
                        label="Revision"
                        name={`${field}.script_revision`}
                        value={step.script_revision}
                        type="number"
                        error={error}
                      />
                    </div>
                    <Field
                      label="Instruction"
                      name={`${field}.instruction`}
                      value={step.instruction}
                      multiline
                      error={error}
                    />
                    <div class="actions">
                      <button
                        type="submit"
                        name="action"
                        value={`up:${i}`}
                        formnovalidate
                        disabled={i === 0}
                      >
                        Up
                      </button>
                      <button
                        type="submit"
                        name="action"
                        value={`down:${i}`}
                        formnovalidate
                        disabled={i === draft.steps.length - 1}
                      >
                        Down
                      </button>
                      <button
                        type="submit"
                        name="action"
                        value={`remove:${i}`}
                        formnovalidate
                      >
                        Remove
                      </button>
                    </div>
                  </fieldset>
                );
              })}
            </div>
            <button
              type="submit"
              name="action"
              value="add_step"
              formnovalidate
              disabled={draft.steps.length >= 30}
            >
              Add step
            </button>
            {draft.steps.length >= 30 && <p>Maximum 30 steps.</p>}
            {choices.length === 0 && (
              <p>
                <a href="/scripts/new">Create a script first</a>, then choose
                its revision.
              </p>
            )}
          </>
        )}
        <div class="actions save">
          <button class="primary" type="submit" name="action" value="save">
            Save {script ? "script" : "runbook"}
          </button>
          <a href={id ? `/${kind}/${id}` : `/${kind}`}>Cancel</a>
        </div>
      </form>
    </>
  );
}
export function Code({ body }: { body: string }) {
  return (
    <div class="code-region">
      <button type="button" data-copy hidden>
        Copy
      </button>
      <pre tabindex={0} aria-label="Script content">
        <code>
          {body.split("\n").map((line, i, lines) => (
            <span class="code-line">
              {line}
              {i < lines.length - 1 ? "\n" : ""}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
export function Detail({
  kind,
  entity,
  id,
  csrf,
  historical,
  headRevision,
}: {
  kind: Kind;
  entity: Entity;
  id: string;
  csrf: string;
  historical?: boolean;
  headRevision?: number;
}) {
  const archived =
    entity.archived_at ??
    entity.script_archived_at ??
    entity.runbook_archived_at;
  return (
    <>
      {historical && (
        <p class="notice">
          Viewing revision {entity.revision} of {headRevision} — read-only.
        </p>
      )}
      <div class="detail">
        <aside>
          <p>
            <span class="badge">rev {entity.revision}</span>{" "}
            {archived && <span class="badge archived">archived</span>}
          </p>
          <p>{entity.description}</p>
          {entity.language && (
            <p>
              {entity.language} · {entity.byte_size} bytes
            </p>
          )}
          {entity.tags && <p>{entity.tags.join(", ")}</p>}
          <nav class="actions" aria-label="Item actions">
            {!historical && !archived && (
              <a href={`/${kind}/${id}/edit`}>Edit</a>
            )}
            <a href={`/${kind}/${id}/revisions`}>History</a>
            {historical && <a href={`/${kind}/${id}`}>Current revision</a>}
            {kind === "runbooks" ? (
              <a
                href={`/runbooks/${id}/revisions/${entity.revision}/export.md`}
              >
                Export Markdown
              </a>
            ) : (
              <a href="/runbooks">Runbooks</a>
            )}
          </nav>
          {!historical && !archived && (
            <form
              method="post"
              action={`/${kind}/${id}/archive`}
              class="archive"
            >
              <input type="hidden" name="csrf" value={csrf} />
              <input
                type="hidden"
                name="expected_revision"
                value={entity.revision}
              />
              <button class="danger" type="submit">
                Archive {kind === "scripts" ? "script" : "runbook"}
              </button>
              <p class="hint">All historical revisions remain available.</p>
            </form>
          )}
        </aside>
        <section class="content">
          {kind === "scripts" ? (
            <Code body={entity.body ?? ""} />
          ) : (
            <ol class="runbook-steps">
              {entity.steps?.map((step) => (
                <li>
                  <h2>{step.script_title}</h2>
                  <p>{step.instruction}</p>
                  <p>
                    <a
                      href={`/scripts/${step.script_id}/revisions/${step.script_revision}`}
                    >
                      Script {step.script_id} · r{step.script_revision}
                    </a>{" "}
                    {step.script_archived && (
                      <span class="badge archived">archived</span>
                    )}
                  </p>
                  <details>
                    <summary>Pinned script content</summary>
                    <Code body={step.body ?? ""} />
                  </details>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </>
  );
}
export function Listing({
  kind,
  items,
  query,
}: {
  kind: Kind;
  items: Entity[];
  query: URLSearchParams;
}) {
  return (
    <>
      <div class="page-actions">
        <a class="button primary" href={`/${kind}/new`}>
          New {kind === "scripts" ? "script" : "runbook"}
        </a>
      </div>
      <form role="search" method="get" class="search">
        <Field label="Search title" name="q" value={query.get("q") ?? ""} />
        {kind === "scripts" && (
          <Field label="Tag" name="tag" value={query.get("tag") ?? ""} />
        )}
        <div class="field">
          <label for="archived">Archive filter</label>
          <select id="archived" name="archived">
            {["exclude", "include", "only"].map((value) => (
              <option
                value={value}
                selected={value === (query.get("archived") ?? "exclude")}
              >
                {value === "exclude"
                  ? "Active"
                  : value === "include"
                    ? "All"
                    : "Archived"}
              </option>
            ))}
          </select>
        </div>
        <button type="submit">Search</button>
        <a href={`/${kind}`}>Clear filters</a>
      </form>
      <p class="hint">{items.length} results on this page</p>
      {items.length === 0 ? (
        <p>
          {query.get("q")
            ? `No ${kind} match “${query.get("q")}”.`
            : kind === "scripts"
              ? "No scripts yet. Paste text or upload a UTF-8 file to get started."
              : "No runbooks yet. Runbooks pin script revisions in an ordered set of instructions."}
        </p>
      ) : (
        <table class="index">
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">
                {kind === "scripts" ? "Tags / language" : "Steps"}
              </th>
              <th scope="col">Revision</th>
              <th scope="col">Updated</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr>
                <td>
                  <a href={`/${kind}/${item.id}`}>{item.title}</a>{" "}
                  {item.archived_at && (
                    <span class="badge archived">archived</span>
                  )}
                </td>
                <td>
                  {kind === "scripts"
                    ? `${item.tags?.join(", ") ?? ""} · ${item.language}`
                    : item.step_count}
                </td>
                <td>rev {item.revision}</td>
                <td>{item.updated_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
