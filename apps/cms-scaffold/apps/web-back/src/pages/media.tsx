import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isApiError, keys, workQueries, type MediaAsset } from "@cms/api";
import { useSession } from "@cms/auth";
import { formatBytes, MediaThumb, UploadPanel } from "@cms/fields";
import {
  Button,
  Card,
  CardContent,
  DefaultSkeleton,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  fill,
  IndexPagination,
  Input,
  Label,
  PAGE_SIZES,
  PageHeader,
  ResourceLayout,
  Skeleton,
  toast,
} from "@cms/ui";
import { api } from "../api";
import { copy } from "../copy";
import { canGlobal } from "../nav";
import { Confirm, SideCard } from "./entry-form";

const DEFAULT_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

/** GET /media needs manage_media (surface-back §3.6-3); without it the library is /forbidden. */
function MediaGate({ children }: { children: ReactNode }) {
  const me = useSession().me!;
  return canGlobal(me, "manage_media") ? <>{children}</> : <Navigate to="/forbidden" replace />;
}

function UploadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="media-upload-dialog">
        <DialogHeader>
          <DialogTitle>{copy["media.uploadTitle"]}</DialogTitle>
          <DialogDescription className="sr-only">{copy["media.uploadTitle"]}</DialogDescription>
        </DialogHeader>
        <UploadPanel onUploaded={() => onOpenChange(false)} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {copy["media.close"]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MediaCard({ asset }: { asset: MediaAsset }) {
  return (
    <Link to={`/media/${asset.id}`} className="rounded-xl" data-testid="media-card">
      <Card className="h-full gap-2 py-3 hover:bg-accent">
        <CardContent className="flex flex-col gap-2 px-3">
          <MediaThumb asset={asset} size={160} />
          <span className="truncate font-semibold">{asset.title}</span>
          <span className="text-table text-subdued">{formatBytes(asset.byteSize)}</span>
        </CardContent>
      </Card>
    </Link>
  );
}

/** Reads `?q=`, `?page=`, `?size=` (01 §4.4). GET /media is not paged, so search and paging happen here. */
function readState(params: URLSearchParams) {
  const size = (PAGE_SIZES as readonly number[]).includes(Number(params.get("size"))) ? Number(params.get("size")) : DEFAULT_SIZE;
  return { q: (params.get("q") ?? "").trim(), page: Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1), size };
}

function LibraryBody() {
  const [params, setParams] = useSearchParams();
  const state = readState(params);
  const library = useQuery(workQueries.mediaList(api.work));
  const [text, setText] = useState(state.q);
  const [uploading, setUploading] = useState(false);

  const update = useCallback(
    (changes: Record<string, string | null>, keepPage = false) => {
      setParams((current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null || value === "") next.delete(key);
          else next.set(key, value);
        }
        if (!keepPage) next.delete("page");
        return next;
      });
    },
    [setParams],
  );
  useEffect(() => setText(state.q), [state.q]);
  useEffect(() => {
    if (text.trim() === state.q) return undefined;
    const timer = setTimeout(() => update({ q: text.trim() }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, state.q, update]);

  let body: ReactNode;
  if (library.isPending) {
    body = (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="query-loading">
        {Array.from({ length: 10 }, (_, i) => (
          <Skeleton key={i} className="aspect-square w-full" />
        ))}
      </div>
    );
  } else if (library.isError) {
    body = <ErrorState onRetry={library.refetch} />;
  } else {
    const needle = state.q.toLowerCase();
    const matches = library.data.items.filter((m) => m.title.toLowerCase().includes(needle));
    const pages = Math.max(1, Math.ceil(matches.length / state.size));
    const page = Math.min(state.page, pages);
    const shown = matches.slice((page - 1) * state.size, page * state.size);
    body =
      library.data.items.length === 0 ? (
        <EmptyState
          testId="media-empty"
          title={copy["media.empty"]}
          description={copy["media.emptyBody"]}
          action={<Button onClick={() => setUploading(true)}>{copy["media.upload"]}</Button>}
        />
      ) : matches.length === 0 ? (
        <EmptyState
          testId="media-no-match"
          title={copy["media.noMatch"]}
          description={copy["media.noMatchBody"]}
          action={<Button variant="outline" onClick={() => update({ q: null })}>{copy["media.clear"]}</Button>}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 rounded-t-xl border border-b-0 bg-surface p-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="media-grid">
            {shown.map((asset) => (
              <MediaCard key={asset.id} asset={asset} />
            ))}
          </div>
          <IndexPagination
            page={page}
            size={state.size}
            total={matches.length}
            onPageChange={(next) => update({ page: next === 1 ? null : String(next) }, true)}
            onSizeChange={(size) => update({ size: size === DEFAULT_SIZE ? null : String(size) })}
          />
        </>
      );
  }

  return (
    <>
      <PageHeader title={copy["media.title"]} primaryAction={{ label: copy["media.upload"], onSelect: () => setUploading(true), testId: "media-upload" }} />
      <div className="mb-4 flex max-w-sm flex-col gap-2">
        <Label htmlFor="media-search">{copy["media.search"]}</Label>
        <Input id="media-search" type="search" value={text} onChange={(event) => setText(event.target.value)} />
      </div>
      {body}
      <UploadDialog open={uploading} onOpenChange={setUploading} />
    </>
  );
}

/** /media — the library (01 §7.2, surface-back §4.8): a grid of every available file, search by name, upload. */
export function MediaLibraryPage() {
  return (
    <MediaGate>
      <LibraryBody />
    </MediaGate>
  );
}

function DetailsBody({ id }: { id: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const media = useQuery(workQueries.media(api.work, id));
  const [confirm, setConfirm] = useState(false);
  const writing = useRef(false);
  const remove = useMutation({
    mutationFn: () => api.work.removeMedia(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.media.list() });
      toast.success(copy["media.deleted"]);
      navigate("/media", { replace: true });
    },
    onError: () => toast.error(copy["details.failed"]),
    onSettled: () => { writing.current = false; },
  });
  if (media.isPending) return <DefaultSkeleton />;
  if (media.isError) {
    if (isApiError(media.error) && media.error.status === 404) return <Navigate to="/not-found" replace />;
    if (isApiError(media.error) && media.error.status === 403) return <Navigate to="/forbidden" replace />;
    return <ErrorState onRetry={media.refetch} />;
  }
  const asset = media.data;
  const image = asset.contentType.startsWith("image/") ? (asset.variants.web ?? asset.variants.original) : undefined;
  return (
    <>
      <PageHeader
        title={asset.title}
        backTo={{ to: "/media", label: copy["media.title"] }}
        moreActions={[{ label: copy["media.delete"], onSelect: () => setConfirm(true), disabled: remove.isPending, testId: "media-delete" }]}
      />
      <ResourceLayout
        main={
          <Card>
            <CardContent>
              {image ? (
                <img
                  src={api.url(image.url)}
                  alt={asset.altText || asset.title}
                  width={image.width ?? undefined}
                  height={image.height ?? undefined}
                  className="h-auto max-w-full rounded-md border"
                  data-testid="media-image"
                />
              ) : (
                <MediaThumb asset={asset} size={160} />
              )}
            </CardContent>
          </Card>
        }
        aside={
          <SideCard title={copy["media.info"]} testId="media-info">
            <p>
              <span className="text-subdued">{copy["media.format"]} </span>
              {asset.contentType}
            </p>
            <p>
              <span className="text-subdued">{copy["media.size"]} </span>
              {formatBytes(asset.byteSize)}
            </p>
            {asset.width && asset.height ? (
              <p>
                <span className="text-subdued">{copy["media.dimensions"]} </span>
                {fill(copy["media.dimensionsValue"], { w: asset.width, h: asset.height })}
              </p>
            ) : null}
            <p>
              <span className="text-subdued">{copy["media.alt"]} </span>
              {asset.altText || "—"}
            </p>
            {asset.variants.original ? (
              <a href={api.url(asset.variants.original.url)} target="_blank" rel="noreferrer" className="text-link hover:underline">
                {copy["media.open"]}
              </a>
            ) : null}
          </SideCard>
        }
      />
      <Confirm
        open={confirm}
        title={fill(copy["media.deleteTitle"], { title: asset.title })}
        body={copy["media.deleteBody"]}
        action={copy["media.delete"]}
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          if (writing.current) return;
          writing.current = true;
          setConfirm(false);
          remove.mutate();
        }}
        testId="confirm-media-delete"
      />
    </>
  );
}

/** /media/:id — one file: large preview, file facts, 移到回收. */
export function MediaDetailsPage() {
  const { id = "" } = useParams();
  return (
    <MediaGate>
      <DetailsBody id={id} />
    </MediaGate>
  );
}
