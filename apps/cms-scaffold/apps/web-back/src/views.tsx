import { Link, useSearchParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { Banner, Button, Card, Field, Input, Page } from "@cms/ui";
import { ApiRequestError, type WorkEntry } from "@cms/api";
import { api } from "./api";

const ISSUE_COLUMNS = ["backlog", "ready", "in_progress", "in_review", "done"] as const;

function mediaId(value: unknown): string | undefined {
  if (typeof value === "string" && value) return value;
  if (value && typeof value === "object" && "mediaId" in value) {
    return String((value as { mediaId: string }).mediaId);
  }
  if (value && typeof value === "object" && "id" in value) {
    return String((value as { id: string }).id);
  }
  return undefined;
}

function sortOrder(entry: WorkEntry): number {
  const value = entry.payload.sortOrder;
  return typeof value === "number" ? value : Number(value || 0);
}

function scheduledDay(entry: WorkEntry): string {
  const raw = String(entry.payload.scheduledAt || "");
  return raw.slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function AlbumComposer() {
  const [albums, setAlbums] = useState<WorkEntry[]>([]);
  const [photos, setPhotos] = useState<WorkEntry[]>([]);
  const [albumId, setAlbumId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    api.entries("album").then((r) => {
      setAlbums(r.items);
      setAlbumId((current) => current || r.items[0]?.id || "");
    }).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!albumId) return;
    api.entries("photo", { "ref.album": albumId })
      .then((r) => setPhotos([...r.items].sort((a, b) => sortOrder(a) - sortOrder(b))))
      .catch((e) => setError(e.message));
  }, [albumId]);

  const album = albums.find((item) => item.id === albumId);

  async function swap(index: number, direction: -1 | 1) {
    const other = index + direction;
    if (other < 0 || other >= photos.length) return;
    const left = photos[index];
    const right = photos[other];
    setError("");
    try {
      await api.csrf();
      await api.patchEntry(left.id, { payload: { sortOrder: sortOrder(right) }, version: left.version });
      await api.patchEntry(right.id, { payload: { sortOrder: sortOrder(left) }, version: right.version });
      const next = await api.entries("photo", { "ref.album": albumId });
      setPhotos([...next.items].sort((a, b) => sortOrder(a) - sortOrder(b)));
      setNotice("已更新 sortOrder");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "排序失敗");
    }
  }

  async function setCover(photo: WorkEntry) {
    if (!album) return;
    const cover = mediaId(photo.payload.media);
    if (!cover) {
      setError("這張相片沒有 media");
      return;
    }
    try {
      await api.csrf();
      const updated = await api.patchEntry(album.id, { payload: { cover }, version: album.version });
      setAlbums((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      setNotice("已設封面");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "設封面失敗");
    }
  }

  return (
    <Page title="相簿編排" eyebrow="album.composer" actions={<Link to="/entries/album"><Button type="button">相簿列表</Button></Link>}>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {notice ? <Banner>{notice}</Banner> : null}
      <Field label="相簿">
        <select
          className="w-full rounded-lg border border-[var(--line)] bg-[#0c1014] px-3 py-2"
          value={albumId}
          onChange={(e) => setAlbumId(e.target.value)}
        >
          {albums.map((item) => (
            <option key={item.id} value={item.id}>{item.title || item.slug}</option>
          ))}
        </select>
      </Field>
      {photos.length === 0 ? <Banner>這本相簿還沒有相片。請從 photo 類型新增。</Banner> : null}
      <ol className="space-y-2">
        {photos.map((photo, index) => (
          <li key={photo.id}>
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <strong>{photo.title || photo.slug}</strong>
                  <p className="text-sm text-[var(--muted)]">
                    sortOrder {sortOrder(photo)}
                    {photo.payload.caption ? ` · ${String(photo.payload.caption)}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={() => swap(index, -1)} disabled={index === 0}>上移</Button>
                  <Button type="button" onClick={() => swap(index, 1)} disabled={index === photos.length - 1}>下移</Button>
                  <Button type="button" onClick={() => setCover(photo)}>設為封面</Button>
                  <Link to={`/entries/photo/${photo.id}`}><Button type="button">編輯</Button></Link>
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ol>
    </Page>
  );
}

export function ClinicSchedule() {
  const [day, setDay] = useState(today);
  const [visits, setVisits] = useState<WorkEntry[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api.entries("visit").then((r) => setVisits(r.items)).catch((e) => setError(e.message));
  }, []);

  const ofDay = useMemo(
    () => visits.filter((visit) => scheduledDay(visit) === day).sort((a, b) => String(a.payload.scheduledAt || "").localeCompare(String(b.payload.scheduledAt || ""))),
    [visits, day],
  );

  return (
    <Page title="當日行程" eyebrow="clinic.schedule" actions={<Link to="/entries/visit/new"><Button type="button">新就診</Button></Link>}>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <Field label="日期">
        <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
      </Field>
      {ofDay.length === 0 ? <Banner>這一天沒有 visit。列表來自通用 entries，沒有診所專用行程 API。</Banner> : null}
      <ul className="space-y-2">
        {ofDay.map((visit) => (
          <li key={visit.id}>
            <Card>
              <Link to={`/entries/visit/${visit.id}`}>
                <strong>{visit.title || "Visit"}</strong>
                <p className="text-sm text-[var(--muted)]">
                  {String(visit.payload.scheduledAt || "")}
                  {visit.payload.visitKind ? ` · ${String(visit.payload.visitKind)}` : ""}
                  {` · ${visit.publicationState}`}
                </p>
              </Link>
            </Card>
          </li>
        ))}
      </ul>
    </Page>
  );
}

export function ProjectsBoard() {
  const [projects, setProjects] = useState<WorkEntry[]>([]);
  const [issues, setIssues] = useState<WorkEntry[]>([]);
  const [projectId, setProjectId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [params] = useSearchParams();

  useEffect(() => {
    const requested = params.get("project") || "";
    api.entries("project").then((r) => {
      setProjects(r.items);
      setProjectId((current) => current || requested || r.items[0]?.id || "");
    }).catch((e) => setError(e.message));
  }, [params]);

  useEffect(() => {
    if (!projectId) return;
    api.entries("issue", { "ref.project": projectId })
      .then((r) => setIssues(r.items.filter((item) => item.publicationState !== "archived")))
      .catch((e) => setError(e.message));
  }, [projectId]);

  async function move(issue: WorkEntry, status: string) {
    if (String(issue.payload.status) === status) return;
    setError("");
    try {
      await api.csrf();
      const updated = await api.patchEntry(issue.id, { payload: { status }, version: issue.version });
      setIssues((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      setNotice(`${updated.title || updated.id} → ${status}（publicationState 仍是 ${updated.publicationState}）`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "搬移失敗");
    }
  }

  return (
    <Page title="看板" eyebrow="projects.board" actions={<Link to="/entries/issue"><Button type="button">Issue 列表</Button></Link>}>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {notice ? <Banner>{notice}</Banner> : null}
      <Field label="專案">
        <select
          className="w-full rounded-lg border border-[var(--line)] bg-[#0c1014] px-3 py-2"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          {projects.map((item) => (
            <option key={item.id} value={item.id}>{item.title || item.slug}</option>
          ))}
        </select>
      </Field>
      <p className="mb-4 text-sm text-[var(--muted)]">挪卡只 PATCH issue.status，不會 publish。沒有看板寫入 API。</p>
      <div className="grid gap-3 overflow-x-auto md:grid-cols-5">
        {ISSUE_COLUMNS.map((column) => (
          <div key={column}>
            <h2 className="mb-2 text-sm uppercase tracking-wide text-[var(--muted)]">{column}</h2>
            <div className="space-y-2">
              {issues.filter((issue) => String(issue.payload.status) === column).map((issue) => (
                <Card key={issue.id}>
                  <Link to={`/entries/issue/${issue.id}`}><strong>{issue.title}</strong></Link>
                  <p className="text-xs text-[var(--muted)]">{issue.publicationState}</p>
                  <select
                    aria-label={`status-${issue.id}`}
                    className="mt-2 w-full rounded-lg border border-[var(--line)] bg-[#0c1014] px-2 py-1 text-sm"
                    value={String(issue.payload.status)}
                    onChange={(e) => move(issue, e.target.value)}
                  >
                    {ISSUE_COLUMNS.map((status) => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Page>
  );
}

export function viewKeysFor(types: string[]): { key: string; label: string; path: string }[] {
  const views = [];
  if (types.includes("album") && types.includes("photo")) {
    views.push({ key: "album.composer", label: "相簿編排", path: "/views/album.composer" });
  }
  if (types.includes("visit")) {
    views.push({ key: "clinic.schedule", label: "當日行程", path: "/views/clinic.schedule" });
  }
  if (types.includes("issue") && types.includes("project")) {
    views.push({ key: "projects.board", label: "看板", path: "/views/projects.board" });
  }
  return views;
}
