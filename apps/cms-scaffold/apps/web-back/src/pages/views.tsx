import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { keys, workQueries, type WorkContentType, type WorkEntry } from "@cms/api";
import { enumLabel, formatDateTime } from "@cms/fields";
import { Button, Card, CardContent, fill, Input, Label, PageHeader, QueryBoundary, StatusBadge, toast } from "@cms/ui";
import { api } from "../api";
import { copy } from "../copy";

// W1 only rewrites what the views show (U-01, U-04: wording, labels, toasts). W2 redoes their behaviour
// (C-08, C-09, C-10, U-03). Preserve BW1b complete-list reads for every composition.
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

/** Display name of an enum value of `type.fields[key]`; the raw value while the schema loads. */
function enumText(type: WorkContentType | undefined, key: string, value: unknown): string {
  const field = type?.fields.find((f) => f.key === key);
  const text = typeof value === "string" ? value : "";
  return field && text ? enumLabel(field, text) : text;
}

export function AlbumComposerPage() {
  const queryClient = useQueryClient();
  const albums = useQuery(workQueries.allEntries(api.work, "album"));
  const [picked, setPicked] = useState("");
  const albumId = picked || albums.data?.items[0]?.id || "";
  const photoParams = { ref: { album: albumId } };
  const photos = useQuery({ ...workQueries.allEntries(api.work, "photo", photoParams), enabled: albumId !== "" });
  const sorted = useMemo(() => [...(photos.data?.items ?? [])].sort((a, b) => sortOrder(a) - sortOrder(b)), [photos.data]);
  const album = albums.data?.items.find((item) => item.id === albumId);

  // C-08 (two separate writes, not atomic) is fixed in W2.
  const swap = useMutation({
    mutationFn: async ({ left, right }: { left: WorkEntry; right: WorkEntry }) => {
      await api.work.patch(left.id, { payload: { sortOrder: sortOrder(right) }, version: left.version });
      await api.work.patch(right.id, { payload: { sortOrder: sortOrder(left) }, version: right.version });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.entries.lists("photo") }),
    onSuccess: () => toast.success(copy["composer.reordered"]),
    onError: () => toast.error(copy["view.failed"]),
  });

  const setCover = useMutation({
    mutationFn: (cover: string) => api.work.patch(album!.id, { payload: { cover }, version: album!.version }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.entries.lists("album") });
      toast.success(copy["composer.coverSet"]);
    },
    onError: () => toast.error(copy["view.failed"]),
  });

  return (
    <>
      <PageHeader title={copy["view.album.composer"]} secondaryActions={[{ label: copy["composer.albumList"], to: "/entries/album" }]} />
      <div className="mb-4 flex flex-col gap-2">
        <Label htmlFor="composer-album">{copy["composer.album"]}</Label>
        <select id="composer-album" className={SELECT} value={albumId} onChange={(e) => setPicked(e.target.value)}>
          {(albums.data?.items ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.title || copy["index.untitled"]}
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
                      <strong>{photo.title || copy["index.untitled"]}</strong>
                      <p className="text-subdued">
                        {fill(copy["composer.position"], { n: index + 1 })}
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
                          else toast.error(copy["composer.noMedia"]);
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
  // C-09 (UTC "today" and UTC day matching) is fixed in W2.
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const visitType = useQuery(workQueries.type(api.work, "visit"));
  const visits = useQuery(workQueries.allEntries(api.work, "visit"));
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
                  <Link to={`/entries/visit/${visit.id}`} className="flex flex-col gap-1 rounded-xl border bg-surface p-4 hover:bg-accent">
                    <strong>{visit.title || copy["schedule.untitled"]}</strong>
                    <span className="flex flex-wrap items-center gap-2 text-subdued">
                      {formatDateTime(visit.payload.scheduledAt)}
                      {visit.payload.visitKind ? ` · ${enumText(visitType.data, "visitKind", visit.payload.visitKind)}` : ""}
                      <StatusBadge state={visit.publicationState} dirty={visit.dirty} />
                    </span>
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
  const projects = useQuery(workQueries.allEntries(api.work, "project"));
  const issueType = useQuery(workQueries.type(api.work, "issue"));
  // C-10 (?project= read only once) is fixed in W2.
  const [picked, setPicked] = useState(() => params.get("project") ?? "");
  const projectId = picked || projects.data?.items[0]?.id || "";
  const issueParams = { ref: { project: projectId } };
  const issues = useQuery({ ...workQueries.allEntries(api.work, "issue", issueParams), enabled: projectId !== "" });
  // 01 §13.2: columns come from the schema's enumValues, never a hard-coded list.
  const columns = issueType.data?.fields.find((f) => f.key === "status")?.enumValues ?? [];

  const move = useMutation({
    mutationFn: ({ issue, status }: { issue: WorkEntry; status: string }) =>
      api.work.patch(issue.id, { payload: { status }, version: issue.version }),
    onSuccess: (updated) => {
      queryClient.setQueryData(keys.entries.allEntries("issue", issueParams), (page: typeof issues.data) =>
        page ? { ...page, items: page.items.map((item) => (item.id === updated.id ? updated : item)) } : page,
      );
      toast.success(fill(copy["board.moved"], { title: updated.title || copy["board.untitled"], status: enumText(issueType.data, "status", updated.payload.status) }));
    },
    onError: () => toast.error(copy["view.failed"]),
  });

  return (
    <>
      <PageHeader title={copy["view.projects.board"]} secondaryActions={[{ label: copy["board.issueList"], to: "/entries/issue" }]} />
      <div className="mb-4 flex flex-col gap-2">
        <Label htmlFor="board-project">{copy["board.project"]}</Label>
        <select id="board-project" className={SELECT} value={projectId} onChange={(e) => setPicked(e.target.value)}>
          {(projects.data?.items ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.title || copy["index.untitled"]}
            </option>
          ))}
        </select>
      </div>
      <p className="mb-4 text-subdued">{copy["board.lead"]}</p>
      <QueryBoundary query={issues}>
        {(page) => {
          const open = page.items.filter((item) => item.publicationState !== "archived");
          return (
            <div className="grid gap-3 md:grid-cols-5">
              {columns.map((column) => {
                const label = enumText(issueType.data, "status", column);
                return (
                  <section key={column} aria-label={label} data-testid={`board-column-${column}`}>
                    <h2 className="mb-2 text-table font-semibold text-subdued">{label}</h2>
                    <div className="flex flex-col gap-2">
                      {open
                        .filter((issue) => String(issue.payload.status) === column)
                        .map((issue) => {
                          const title = issue.title || copy["board.untitled"];
                          return (
                            <Card key={issue.id}>
                              <CardContent className="flex flex-col gap-2">
                                <Link to={`/entries/issue/${issue.id}`} className="font-semibold hover:underline">
                                  {title}
                                </Link>
                                <StatusBadge state={issue.publicationState} dirty={issue.dirty} />
                                <select
                                  aria-label={fill(copy["board.statusLabel"], { title })}
                                  className={SELECT}
                                  value={String(issue.payload.status)}
                                  onChange={(e) => move.mutate({ issue, status: e.target.value })}
                                >
                                  {columns.map((status) => (
                                    <option key={status} value={status}>
                                      {enumText(issueType.data, "status", status)}
                                    </option>
                                  ))}
                                </select>
                              </CardContent>
                            </Card>
                          );
                        })}
                    </div>
                  </section>
                );
              })}
            </div>
          );
        }}
      </QueryBoundary>
    </>
  );
}
