import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { keys, workQueries, type WorkEntry } from "@cms/api";
import { Alert, AlertDescription, Badge, Button, Card, CardContent, Input, Label, PageHeader, QueryBoundary } from "@cms/ui";
import { api } from "../api";
import { copy } from "../copy";

// W0 ports the v1 custom views unchanged in behaviour. W2 redoes them (C-08, C-09, C-10, U-03).
const ISSUE_COLUMNS = ["backlog", "ready", "in_progress", "in_review", "done"] as const;
const SELECT = "h-9 w-full rounded-md border border-input bg-background px-3";

function sortOrder(entry: WorkEntry): number {
  const value = entry.payload.sortOrder;
  return typeof value === "number" ? value : Number(value || 0);
}

function mediaId(value: unknown): string | undefined {
  if (typeof value === "string" && value) return value;
  if (value && typeof value === "object" && "id" in value) return String((value as { id: unknown }).id);
  return undefined;
}

function Notice({ text, error }: { text: string; error: boolean }) {
  if (!text) return null;
  return (
    <Alert variant={error ? "destructive" : "default"} className="mb-4" data-testid="view-notice">
      <AlertDescription>{text}</AlertDescription>
    </Alert>
  );
}

export function AlbumComposerPage() {
  const queryClient = useQueryClient();
  const albums = useQuery(workQueries.entries(api.work, "album"));
  const [picked, setPicked] = useState("");
  const albumId = picked || albums.data?.items[0]?.id || "";
  const photos = useQuery({ ...workQueries.entries(api.work, "photo", { ref: { album: albumId } }), enabled: albumId !== "" });
  const sorted = useMemo(() => [...(photos.data?.items ?? [])].sort((a, b) => sortOrder(a) - sortOrder(b)), [photos.data]);
  const album = albums.data?.items.find((item) => item.id === albumId);
  const [notice, setNotice] = useState({ text: "", error: false });

  // C-08 (two separate PATCHes, not atomic) is fixed in W2.
  const swap = useMutation({
    mutationFn: async ({ left, right }: { left: WorkEntry; right: WorkEntry }) => {
      await api.work.patch(left.id, { payload: { sortOrder: sortOrder(right) }, version: left.version });
      await api.work.patch(right.id, { payload: { sortOrder: sortOrder(left) }, version: right.version });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.entries.lists("photo") }),
    onSuccess: () => setNotice({ text: copy["composer.reordered"], error: false }),
    onError: () => setNotice({ text: copy["editor.error"], error: true }),
  });

  const setCover = useMutation({
    mutationFn: (cover: string) => api.work.patch(album!.id, { payload: { cover }, version: album!.version }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.entries.lists("album") });
      setNotice({ text: copy["composer.coverSet"], error: false });
    },
    onError: () => setNotice({ text: copy["editor.error"], error: true }),
  });

  return (
    <>
      <PageHeader title={copy["view.album.composer"]} secondaryActions={[{ label: copy["composer.albumList"], to: "/entries/album" }]} />
      <Notice {...notice} />
      <div className="mb-4 flex flex-col gap-2">
        <Label htmlFor="composer-album">{copy["composer.album"]}</Label>
        <select id="composer-album" className={SELECT} value={albumId} onChange={(e) => setPicked(e.target.value)}>
          {(albums.data?.items ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.title || item.slug}
            </option>
          ))}
        </select>
      </div>
      <QueryBoundary query={photos} isEmpty={(page) => page.items.length === 0} empty={<p className="text-subdued">{copy["composer.empty"]}</p>}>
        {() => (
          <ol className="flex flex-col gap-2">
            {sorted.map((photo, index) => (
              <li key={photo.id}>
                <Card>
                  <CardContent className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <strong>{photo.title || photo.slug}</strong>
                      <p className="text-subdued">
                        sortOrder {sortOrder(photo)}
                        {photo.payload.caption ? ` · ${String(photo.payload.caption)}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" disabled={index === 0} onClick={() => swap.mutate({ left: photo, right: sorted[index - 1] })}>
                        {copy["composer.up"]}
                      </Button>
                      <Button size="sm" variant="outline" disabled={index === sorted.length - 1} onClick={() => swap.mutate({ left: photo, right: sorted[index + 1] })}>
                        {copy["composer.down"]}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const cover = mediaId(photo.payload.media);
                          if (cover) setCover.mutate(cover);
                          else setNotice({ text: copy["composer.noMedia"], error: true });
                        }}
                      >
                        {copy["composer.cover"]}
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <Link to={`/entries/photo/${photo.id}`}>{copy["composer.edit"]}</Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ol>
        )}
      </QueryBoundary>
    </>
  );
}

function scheduledDay(entry: WorkEntry): string {
  return String(entry.payload.scheduledAt || "").slice(0, 10);
}

export function ClinicSchedulePage() {
  // C-09 (UTC "today") is fixed in W2.
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const visits = useQuery(workQueries.entries(api.work, "visit"));
  return (
    <>
      <PageHeader title={copy["view.clinic.schedule"]} primaryAction={{ label: copy["schedule.newVisit"], to: "/entries/visit/new" }} />
      <div className="mb-4 flex max-w-xs flex-col gap-2">
        <Label htmlFor="schedule-date">{copy["schedule.date"]}</Label>
        <Input id="schedule-date" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
      </div>
      <QueryBoundary query={visits}>
        {(page) => {
          const ofDay = page.items
            .filter((visit) => scheduledDay(visit) === day)
            .sort((a, b) => String(a.payload.scheduledAt).localeCompare(String(b.payload.scheduledAt)));
          if (ofDay.length === 0) return <p className="text-subdued">{copy["schedule.empty"]}</p>;
          return (
            <ul className="flex flex-col gap-2">
              {ofDay.map((visit) => (
                <li key={visit.id}>
                  <Link to={`/entries/visit/${visit.id}`} className="block rounded-xl border bg-surface p-4 hover:bg-accent">
                    <strong>{visit.title || copy["schedule.fallbackTitle"]}</strong>
                    <p className="text-subdued">
                      {String(visit.payload.scheduledAt || "")}
                      {visit.payload.visitKind ? ` · ${String(visit.payload.visitKind)}` : ""} · {visit.publicationState}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          );
        }}
      </QueryBoundary>
    </>
  );
}

export function ProjectsBoardPage() {
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const projects = useQuery(workQueries.entries(api.work, "project"));
  // C-10 (?project= read only once) is fixed in W2.
  const [picked, setPicked] = useState(() => params.get("project") ?? "");
  const projectId = picked || projects.data?.items[0]?.id || "";
  const issueParams = { ref: { project: projectId } };
  const issues = useQuery({ ...workQueries.entries(api.work, "issue", issueParams), enabled: projectId !== "" });
  const [notice, setNotice] = useState({ text: "", error: false });

  const move = useMutation({
    mutationFn: ({ issue, status }: { issue: WorkEntry; status: string }) =>
      api.work.patch(issue.id, { payload: { status }, version: issue.version }),
    onSuccess: (updated) => {
      queryClient.setQueryData(keys.entries.list("issue", issueParams), (page: typeof issues.data) =>
        page ? { ...page, items: page.items.map((item) => (item.id === updated.id ? updated : item)) } : page,
      );
      setNotice({ text: `${copy["board.moved"]} ${updated.title ?? updated.id} → ${String(updated.payload.status)}`, error: false });
    },
    onError: () => setNotice({ text: copy["editor.error"], error: true }),
  });

  return (
    <>
      <PageHeader title={copy["view.projects.board"]} secondaryActions={[{ label: copy["board.issueList"], to: "/entries/issue" }]} />
      <Notice {...notice} />
      <div className="mb-4 flex flex-col gap-2">
        <Label htmlFor="board-project">{copy["board.project"]}</Label>
        <select id="board-project" className={SELECT} value={projectId} onChange={(e) => setPicked(e.target.value)}>
          {(projects.data?.items ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.title || item.slug}
            </option>
          ))}
        </select>
      </div>
      <p className="mb-4 text-subdued">{copy["board.note"]}</p>
      <QueryBoundary query={issues}>
        {(page) => {
          const open = page.items.filter((item) => item.publicationState !== "archived");
          return (
            <div className="grid gap-3 md:grid-cols-5">
              {ISSUE_COLUMNS.map((column) => (
                <section key={column} aria-label={column}>
                  <h2 className="mb-2 text-table font-semibold text-subdued">{column}</h2>
                  <div className="flex flex-col gap-2">
                    {open
                      .filter((issue) => String(issue.payload.status) === column)
                      .map((issue) => (
                        <Card key={issue.id}>
                          <CardContent className="flex flex-col gap-2">
                            <Link to={`/entries/issue/${issue.id}`} className="font-semibold hover:underline">
                              {issue.title}
                            </Link>
                            <Badge variant="secondary">{issue.publicationState}</Badge>
                            <select
                              aria-label={`${copy["board.statusLabel"]} ${issue.title ?? issue.id}`}
                              className={SELECT}
                              value={String(issue.payload.status)}
                              onChange={(e) => move.mutate({ issue, status: e.target.value })}
                            >
                              {ISSUE_COLUMNS.map((status) => (
                                <option key={status} value={status}>
                                  {status}
                                </option>
                              ))}
                            </select>
                          </CardContent>
                        </Card>
                      ))}
                  </div>
                </section>
              ))}
            </div>
          );
        }}
      </QueryBoundary>
    </>
  );
}
