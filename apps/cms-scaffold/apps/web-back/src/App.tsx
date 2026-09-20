import { Link, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Banner, Button, Card, Field, Input, Page } from "@cms/ui";
import { ApiRequestError, type ContentType, type Me, type WorkEntry } from "@cms/api";
import { api } from "./api";
import { AlbumComposer, ClinicSchedule, ProjectsBoard, viewKeysFor } from "./views";

function useMe() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    api.me().then(setMe).catch(() => setMe(null));
  }, []);
  return me;
}

function Login() {
  const [username, setUsername] = useState("seed-operator-album");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.csrf();
      const me = await api.login(username, password);
      if (!me.surfaces.back) {
        setError("這個帳號不能進 Back office。");
        return;
      }
      window.location.assign("/");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "登入失敗");
    }
  }
  return (
    <Page title="Back office 登入" eyebrow="web-back">
      <form className="max-w-sm" onSubmit={onSubmit}>
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <Field label="帳號"><Input value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
        <Field label="密碼"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Button type="submit">登入</Button>
      </form>
    </Page>
  );
}

function allowedTypes(me: Me): string[] {
  const set = new Set<string>();
  me.roles.forEach((role) => role.contentTypeCodes.forEach((code) => set.add(code)));
  if (me.roles.some((r) => r.code === "admin")) {
    return ["album", "photo", "page", "clinic_profile", "owner", "pet", "vet", "visit", "project", "issue", "milestone"];
  }
  return [...set];
}

function Shell({ me, children }: { me: Me; children: React.ReactNode }) {
  const types = useMemo(() => allowedTypes(me), [me]);
  const views = useMemo(() => viewKeysFor(types), [types]);
  return (
    <div>
      <nav className="border-b border-[var(--line)] px-6 py-3 text-sm">
        <div className="mx-auto flex max-w-5xl flex-wrap gap-3">
          <Link to="/">Back</Link>
          {views.map((view) => <Link key={view.key} to={view.path}>{view.label}</Link>)}
          {types.map((type) => <Link key={type} to={`/entries/${type}`}>{type}</Link>)}
          <button className="ml-auto" onClick={async () => { await api.csrf(); await api.logout(); window.location.assign("/login"); }}>登出 {me.principal.username}</button>
        </div>
      </nav>
      {children}
    </div>
  );
}

function Dashboard({ me }: { me: Me }) {
  const views = viewKeysFor(allowedTypes(me));
  return (
    <Page title="作業台" eyebrow="Back office">
      <p className="mb-4 text-[var(--muted)]">以內容類型作業。沒有 Admin 治理選單。自訂視圖寫入仍走 entry API。</p>
      {views.length ? (
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          {views.map((view) => (
            <Card key={view.key}>
              <Link to={view.path}>
                <h2 className="text-xl">{view.label}</h2>
                <p className="text-[var(--muted)]">{view.key}</p>
              </Link>
            </Card>
          ))}
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {me.roles.map((role) => (
          <Card key={role.code}>
            <strong>{role.code}</strong>
            <p className="text-[var(--muted)]">{role.contentTypeCodes.join(", ") || "全部類型"}</p>
          </Card>
        ))}
      </div>
    </Page>
  );
}

function EntryList() {
  const { type = "album" } = useParams();
  const [items, setItems] = useState<WorkEntry[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    api.entries(type).then((r) => setItems(r.items)).catch((e) => setError(e.message));
  }, [type]);
  return (
    <Page title={type} eyebrow="Entries" actions={<Link to={`/entries/${type}/new`}><Button type="button">新建</Button></Link>}>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {items.length === 0 && !error ? <Banner>尚無內容。建立第一筆草稿。</Banner> : null}
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id}>
            <Link to={`/entries/${type}/${item.id}`}>{item.title || item.slug || item.id} · {item.publicationState}</Link>
          </li>
        ))}
      </ul>
    </Page>
  );
}

function canPublish(me: Me | null | undefined) {
  return !!me && me.roles.some((role) => role.code === "operator" || role.code === "admin");
}

function Forbidden() {
  return <Page title="沒有權限"><Banner tone="danger">這個帳號不能進 Back office。</Banner></Page>;
}

function EntryEditor() {
  const me = useMe();
  const { type = "album", id } = useParams();
  const isNew = id === "new" || !id;
  const [schema, setSchema] = useState<ContentType | null>(null);
  const [entry, setEntry] = useState<WorkEntry | null>(null);
  const [slug, setSlug] = useState("");
  const [payload, setPayload] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    api.type(type).then(setSchema).catch((e) => setError(e.message));
    if (!isNew && id) {
      api.getEntry(id).then((e) => {
        setEntry(e);
        setSlug(e.slug || "");
        const next: Record<string, string> = {};
        Object.entries(e.payload || {}).forEach(([k, v]) => {
          next[k] = typeof v === "object" ? JSON.stringify(v) : String(v ?? "");
        });
        setPayload(next);
      }).catch((e) => setError(e.message));
    }
  }, [type, id, isNew]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    const body: Record<string, unknown> = {};
    schema?.fields?.forEach((field) => {
      const raw = payload[field.key];
      if (raw == null || raw === "") return;
      if (field.type === "int") body[field.key] = Number(raw);
      else body[field.key] = raw;
    });
    try {
      await api.csrf();
      if (isNew) {
        const created = await api.createEntry(type, { slug, payload: body });
        navigate(`/entries/${type}/${created.id}`);
      } else if (id) {
        const updated = await api.patchEntry(id, { slug, payload: body, version: entry?.version });
        setEntry(updated);
        setNotice("已儲存工作副本");
      }
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "儲存失敗");
    }
  }

  async function act(fn: (id: string) => Promise<WorkEntry>) {
    if (!id || isNew) return;
    try {
      await api.csrf();
      const updated = await fn(id);
      setEntry(updated);
      setNotice(updated.publicationState);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "操作失敗");
    }
  }

  async function onUpload(file: File, fieldKey: string) {
    try {
      await api.csrf();
      const media = await api.upload(file);
      setPayload((p) => ({ ...p, [fieldKey]: media.id }));
      setNotice("已上傳 " + media.id);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "上傳失敗");
    }
  }

  return (
    <Page title={isNew ? `新建 ${type}` : entry?.title || type} eyebrow="Editor">
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {notice ? <Banner>{notice}</Banner> : null}
      {!isNew ? <Banner>草稿預覽留在 Back（工作副本），不會開 Front origin。</Banner> : null}
      <form onSubmit={save} className="max-w-xl">
        <Field label="slug"><Input value={slug} onChange={(e) => setSlug(e.target.value)} /></Field>
        {schema?.fields?.map((field) => (
          <Field key={field.key} label={`${field.key} (${field.type})`}>
            {field.type === "media-ref" ? (
              <div>
                <Input value={payload[field.key] || ""} onChange={(e) => setPayload((p) => ({ ...p, [field.key]: e.target.value }))} />
                <input className="mt-2 text-sm" type="file" onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0], field.key)} />
              </div>
            ) : (
              <Input
                multiline={field.type === "markdown"}
                value={payload[field.key] || ""}
                onChange={(e) => setPayload((p) => ({ ...p, [field.key]: e.target.value }))}
              />
            )}
          </Field>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button type="submit">儲存草稿</Button>
          {canPublish(me) && !isNew ? <Button type="button" onClick={() => act(api.publish)}>發布</Button> : null}
          {canPublish(me) && !isNew ? <Button type="button" onClick={() => act(api.unpublish)}>下架</Button> : null}
          {canPublish(me) && !isNew ? <Button type="button" tone="danger" onClick={() => act(api.archive)}>封存</Button> : null}
        </div>
      </form>
    </Page>
  );
}

export default function App() {
  const me = useMe();
  if (me === undefined) return <Page title="Back office"><Banner>檢查 session…</Banner></Page>;
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/sign-in" element={<Navigate to="/login" replace />} />
      <Route
        path="/*"
        element={
          !me ? (
            <Navigate to="/login" replace />
          ) : !me.surfaces.back ? (
            <Forbidden />
          ) : (
            <Shell me={me}>
              <Routes>
                <Route path="/" element={<Dashboard me={me} />} />
                <Route path="/views/album.composer" element={<AlbumComposer />} />
                <Route path="/views/clinic.schedule" element={<ClinicSchedule />} />
                <Route path="/views/projects.board" element={<ProjectsBoard />} />
                <Route path="/entries/:type" element={<EntryList />} />
                <Route path="/entries/:type/new" element={<EntryEditor />} />
                <Route path="/entries/:type/:id" element={<EntryEditor />} />
              </Routes>
            </Shell>
          )
        }
      />
    </Routes>
  );
}
