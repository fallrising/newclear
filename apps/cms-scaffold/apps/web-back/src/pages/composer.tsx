import { useRef, useState } from "react";
import { Link } from "react-router";
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { rectSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { keys, workQueries, type WorkEntry } from "@cms/api";
import { useSession } from "@cms/auth";
import { MediaThumb } from "@cms/fields";
import {
  Badge,
  Button,
  Card,
  CardContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  fill,
  PageHeader,
  QueryBoundary,
  Skeleton,
  StatusBadge,
  toast,
} from "@cms/ui";
import { api } from "../api";
import { copy } from "../copy";
import { can, canGlobal } from "../nav";
import { dndTexts, EntrySelect, pickEntry, titleOf, useDropClickGuard, useQueryParam } from "./view-common";

/** B-S5: positions are renumbered 10, 20, 30… (01 §7.2); only photos whose number changes are written. */
const STEP = 10;
type CompleteEntries = Awaited<ReturnType<typeof api.work.allEntries>>;

function sortOrder(photo: WorkEntry): number | null {
  const value = photo.payload.sortOrder;
  return typeof value === "number" ? value : null;
}

function mediaId(value: unknown): string | null {
  return typeof value === "string" && value ? value : value && typeof value === "object" && "mediaId" in value && typeof value.mediaId === "string" ? value.mediaId : null;
}

function mediaOf(photo: WorkEntry): string | null {
  return mediaId(photo.payload.media);
}

/** The file name without its extension, as the new photo's title. */
function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "") || name;
}

function PhotoThumb({ id }: { id: string | null }) {
  const media = useQuery({ ...workQueries.media(api.work, id ?? ""), enabled: id !== null, retry: false });
  if (id === null || media.isError) return <div className="aspect-square w-full rounded-md border bg-surface-subdued" />;
  if (media.isPending) return <Skeleton className="aspect-square w-full" />;
  return <MediaThumb asset={media.data} size={160} />;
}

interface PhotoCardProps {
  photo: WorkEntry;
  index: number;
  count: number;
  cover: boolean;
  busy: boolean;
  onMove: (from: number, to: number) => void;
  onCover: (photo: WorkEntry) => void;
}

function PhotoCard({ photo, index, count, cover, busy, onMove, onCover }: PhotoCardProps) {
  // Pointer dragging only; keyboard and screen-reader users move photos with the card's menu (D-10).
  const me = useSession().me!;
  const sortable = useSortable({ id: photo.id, disabled: busy || !can(me, "photo", "update") });
  const guard = useDropClickGuard(sortable.isDragging);
  const title = titleOf(photo);
  const style = {
    transform: sortable.transform ? `translate3d(${sortable.transform.x}px, ${sortable.transform.y}px, 0)` : undefined,
    transition: sortable.transition,
    zIndex: sortable.isDragging ? 1 : undefined,
  };
  return (
    <li ref={sortable.setNodeRef} style={style} {...sortable.listeners} {...guard} className="touch-none" data-testid="composer-photo" data-photo={photo.id}>
      <Card className="h-full gap-2 py-3">
        <CardContent className="flex flex-col gap-2 px-3">
          <PhotoThumb id={mediaOf(photo)} />
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-col gap-1">
              <strong className="truncate">{title}</strong>
              <span className="text-table text-subdued">{fill(copy["composer.position"], { n: index + 1 })}</span>
              <span className="flex flex-wrap items-center gap-1">
                {cover ? (
                  <Badge variant="outline" className="rounded-full" data-testid="composer-cover">
                    <span aria-hidden="true">★</span>
                    {copy["composer.isCover"]}
                  </Badge>
                ) : null}
                <StatusBadge state={photo.publicationState} dirty={photo.dirty} requested={photo.publishRequestedAt !== null} />
              </span>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon" aria-label={fill(copy["composer.actions"], { title })} data-testid="composer-menu">
                  <span aria-hidden="true">⋯</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={busy || index === 0} onSelect={() => onMove(index, index - 1)} data-testid="composer-left">
                  {copy["composer.left"]}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={busy || index === count - 1} onSelect={() => onMove(index, index + 1)} data-testid="composer-right">
                  {copy["composer.right"]}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={busy || cover || mediaOf(photo) === null} onSelect={() => onCover(photo)} data-testid="composer-set-cover">
                  {copy["composer.cover"]}
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to={`/entries/photo/${photo.id}`}>{copy["composer.edit"]}</Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardContent>
      </Card>
    </li>
  );
}

function Photos({ album }: { album: WorkEntry }) {
  const me = useSession().me!;
  const queryClient = useQueryClient();
  const params = { ref: { album: album.id }, sort: "sortOrder" };
  const listKey = keys.entries.allEntries("photo", params);
  const photos = useQuery(workQueries.allEntries(api.work, "photo", params));
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const writing = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const items = photos.data?.items ?? [];
  const cover = mediaId(album.payload.cover);

  // C-08 / G-09: one atomic batch; the new order shows at once and is rolled back if the batch fails.
  const reorder = useMutation({
    mutationFn: (ordered: WorkEntry[]) => {
      const changes = ordered.flatMap((photo, i) =>
        sortOrder(photo) === (i + 1) * STEP ? [] : [{ id: photo.id, version: photo.version, payload: { sortOrder: (i + 1) * STEP } }],
      );
      return changes.length ? api.work.batchPatch(changes) : Promise.resolve({ items: [] });
    },
    onSettled: () => { writing.current = false; },
    onMutate: async (ordered) => {
      await queryClient.cancelQueries({ queryKey: listKey });
      const previous = queryClient.getQueryData<CompleteEntries>(listKey);
      queryClient.setQueryData<CompleteEntries>(listKey, (page) =>
        page ? { ...page, items: ordered.map((p, i) => ({ ...p, payload: { ...p.payload, sortOrder: (i + 1) * STEP } })) } : page,
      );
      return { previous };
    },
    onSuccess: (result) => {
      const updated = new Map(result.items.map((e) => [e.id, e]));
      queryClient.setQueryData<CompleteEntries>(listKey, (page) => (page ? { ...page, items: page.items.map((p) => updated.get(p.id) ?? p) } : page));
      for (const entry of result.items) queryClient.setQueryData(keys.entries.detail(entry.id), entry);
      toast.success(copy["composer.reordered"]);
    },
    onError: (_error, _ordered, context) => {
      if (context?.previous) queryClient.setQueryData(listKey, context.previous);
      void queryClient.invalidateQueries({ queryKey: keys.entries.lists("photo") });
      toast.error(copy["composer.reorderFailed"]);
    },
  });

  const setCover = useMutation({
    mutationFn: (media: string) => api.work.patch(album.id, { version: album.version, payload: { cover: media } }),
    onSuccess: (updated) => {
      queryClient.setQueryData(keys.entries.detail(updated.id), updated);
      void queryClient.invalidateQueries({ queryKey: keys.entries.lists("album") });
      toast.success(copy["composer.coverSet"]);
    },
    onError: () => toast.error(copy["view.failed"]),
    onSettled: () => { writing.current = false; },
  });

  function move(from: number, to: number) {
    if (writing.current || from < 0 || to < 0 || to >= items.length || from === to) return;
    const ordered = [...items];
    ordered.splice(to, 0, ordered.splice(from, 1)[0]);
    const changed = ordered.filter((photo, i) => sortOrder(photo) !== (i + 1) * STEP);
    if (changed.length > 100) {
      toast.error(copy["composer.tooManyChanges"]);
      return;
    }
    if (!changed.length) return;
    writing.current = true;
    reorder.mutate(ordered);
  }

  function dragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    move(items.findIndex((p) => p.id === active.id), items.findIndex((p) => p.id === over.id));
  }

  /** Multi-file upload (01 B-S5): each file becomes a draft photo of this album, appended after the last one. */
  async function upload(files: File[]) {
    if (writing.current) return;
    writing.current = true;
    let next = Math.max(0, ...items.map((p) => sortOrder(p) ?? 0)) + STEP;
    let added = 0;
    setProgress({ done: 0, total: files.length });
    for (const [i, file] of files.entries()) {
      try {
        const asset = await api.work.upload(file);
        await api.work.create("photo", { slug: null, payload: { title: baseName(file.name), album: album.id, media: asset.id, sortOrder: next } });
        next += STEP;
        added += 1;
      } catch {
        // counted below; the other files still upload
      }
      setProgress({ done: i + 1, total: files.length });
    }
    setProgress(null);
    writing.current = false;
    void queryClient.invalidateQueries({ queryKey: keys.entries.lists("photo") });
    void queryClient.invalidateQueries({ queryKey: keys.media.list() });
    if (added) toast.success(fill(copy["composer.uploaded"], { n: added }));
    if (added < files.length) toast.error(fill(copy["composer.uploadFailed"], { n: files.length - added }));
  }

  const canUpload = can(me, "photo", "create") && canGlobal(me, "manage_media");
  const busy = reorder.isPending || setCover.isPending || progress !== null;
  const names = new Map(items.map((p) => [p.id, titleOf(p)]));
  const name = (id: string | number) => names.get(String(id)) ?? "";
  return (
    <>
      {canUpload ? (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" disabled={busy} onClick={() => input.current?.click()} data-testid="composer-upload">
            {copy["composer.upload"]}
          </Button>
          <input
            ref={input}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/gif"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              event.target.value = "";
              if (files.length) void upload(files);
            }}
            data-testid="composer-upload-input"
          />
          <span aria-live="polite" className="text-subdued" data-testid="composer-progress">
            {progress ? fill(copy["composer.uploading"], { done: progress.done, total: progress.total }) : ""}
          </span>
        </div>
      ) : null}
      <QueryBoundary
        query={photos}
        isEmpty={(page) => page.items.length === 0}
        empty={<EmptyState testId="composer-empty" title={copy["composer.empty"]} description={copy["composer.emptyBody"]} />}
      >
        {() => (
          <DndContext sensors={sensors} onDragEnd={dragEnd} accessibility={dndTexts(name, name)}>
            <SortableContext items={items.map((p) => p.id)} strategy={rectSortingStrategy}>
              <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="composer-grid">
                {items.map((photo, index) => (
                  <PhotoCard
                    key={photo.id}
                    photo={photo}
                    index={index}
                    count={items.length}
                    cover={cover !== null && mediaOf(photo) === cover}
                    busy={busy}
                    onMove={move}
                    onCover={(p) => { if (writing.current) return; writing.current = true; setCover.mutate(mediaOf(p)!); }}
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
        )}
      </QueryBoundary>
    </>
  );
}

/** /views/album.composer — B-S5: order, cover and upload for one album; the album is `?album=` (two-way). */
export function AlbumComposerPage() {
  const me = useSession().me!;
  const albums = useQuery(workQueries.allEntries(api.work, "album"));
  const [albumId, setAlbumId] = useQueryParam("album");
  const album = pickEntry(albums.data?.items, albumId);
  return (
    <>
      <PageHeader title={copy["view.album.composer"]} secondaryActions={[{ label: copy["composer.albumList"], to: "/entries/album" }]} />
      <p className="mb-4 text-subdued">{copy["composer.lead"]}</p>
      <QueryBoundary
        query={albums}
        isEmpty={(page) => page.items.length === 0}
        empty={
          <EmptyState
            testId="composer-no-albums"
            title={copy["composer.noAlbums"]}
            description={copy["composer.noAlbumsBody"]}
            action={can(me, "album", "create") ? <Button asChild><Link to="/entries/album/new">{copy["composer.newAlbum"]}</Link></Button> : undefined}
          />
        }
      >
        {(page) => (
          <>
            <div className="mb-4">
              <EntrySelect id="composer-album" label={copy["composer.album"]} entries={page.items} value={album!.id} onChange={setAlbumId} />
            </div>
            <Photos key={album!.id} album={album!} />
          </>
        )}
      </QueryBoundary>
    </>
  );
}
