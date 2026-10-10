import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { publicQueries, type PublicEntry } from "@cms/api/public";
import { api } from "../api";
import { copy } from "../copy";
import { ListPage } from "../home";
import { LightboxDialog } from "../lightbox";
import { MarkdownBody } from "../markdown";
import { altOf, formatDate, imageOf, text } from "../media";
import { Crumbs, PublicImage } from "../parts";
import { summarize, usePageMeta } from "../seo";
import { FrontTitle } from "../shell";
import { ALBUM_GRID } from "../sites";
import { DetailSkeleton, EmptyPublished, GridSkeleton, PublicBoundary } from "../states";

/** Photos of one album in public order (the photo type's sortField). One request, the API maximum (W3 §1.2). */
function albumPhotos(albumId: string) {
  return publicQueries.entries(api.public, "photo", { ref: { album: albumId }, size: 100 });
}

/** Lightbox key of a photo: its slug, or its id when it has none (photo slugs are optional). */
function photoKey(photo: PublicEntry): string {
  return photo.slug ?? photo.id;
}

export function AlbumList() {
  return (
    <ListPage
      grid={ALBUM_GRID}
      title={copy["album.list.title"]}
      crumbs={[{ label: copy["site.album"], to: "/album" }, { label: copy["album.list.title"] }]}
      description={copy["selector.album.body"]}
    />
  );
}

function PhotoTile({ photo, onOpen }: { photo: PublicEntry; onOpen: (trigger: HTMLElement) => void }) {
  const image = imageOf(photo.payload.media, "thumbnail");
  const caption = text(photo.payload.caption);
  const content: ReactNode = image ? (
    <PublicImage
      image={image}
      alt={altOf(photo.payload.media, caption, photo.title)}
      loading="lazy"
      className="aspect-square w-full rounded-lg object-cover"
    />
  ) : (
    <span className="flex aspect-square w-full items-center justify-center rounded-lg bg-surface-subdued text-subdued">
      {photo.title ?? copy["photo.fallbackTitle"]}
    </span>
  );
  if (!photo.slug) {
    return (
      <button type="button" onClick={(event) => onOpen(event.currentTarget)} className="block w-full rounded-lg" data-testid="photo-tile" data-photo-key={photoKey(photo)}>
        {content}
      </button>
    );
  }
  // A real link: Ctrl/⌘/Shift-click and middle-click open the photo page; a plain click opens the lightbox.
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onOpen(event.currentTarget);
  }
  return (
    <Link to={`/album/photos/${photo.slug}`} onClick={onClick} className="block rounded-lg" data-testid="photo-tile" data-photo-key={photoKey(photo)}>
      {content}
    </Link>
  );
}

/** F-S2 photo wall: 1:1 thumbnails; ?photo=<key> opens the lightbox (shareable, survives reload). */
function PhotoWall({ albumId }: { albumId: string }) {
  const photos = useQuery(albumPhotos(albumId));
  const [params, setParams] = useSearchParams();
  const wallRef = useRef<HTMLUListElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const openingKeyRef = useRef<string | null>(params.get("photo"));
  const selectedKey = params.get("photo");
  useEffect(() => {
    if (selectedKey !== null && openingKeyRef.current === null) openingKeyRef.current = selectedKey;
  }, [selectedKey]);

  function returnFocus() {
    const opener = openerRef.current;
    const fallback = Array.from(wallRef.current?.querySelectorAll<HTMLElement>("[data-photo-key]") ?? [])
      .find((tile) => tile.dataset.photoKey === openingKeyRef.current);
    (opener?.isConnected ? opener : fallback)?.focus();
    openerRef.current = null;
    openingKeyRef.current = null;
  }
  function setPhoto(key: string | null, replace: boolean) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (key === null) next.delete("photo");
        else next.set("photo", key);
        return next;
      },
      { replace, preventScrollReset: true },
    );
  }
  return (
    <PublicBoundary
      query={photos}
      level="section"
      skeleton={<GridSkeleton square />}
      isEmpty={(data) => data.items.length === 0}
      empty={<EmptyPublished title={copy["empty.photos"]} />}
    >
      {(data) => {
        const index = data.items.findIndex((photo) => photoKey(photo) === params.get("photo"));
        return (
          <>
            <ul ref={wallRef} className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {data.items.map((photo) => (
                <li key={photo.id}>
                  <PhotoTile photo={photo} onOpen={(trigger) => {
                    openerRef.current = trigger;
                    openingKeyRef.current = photoKey(photo);
                    setPhoto(photoKey(photo), false);
                  }} />
                </li>
              ))}
            </ul>
            <LightboxDialog
              photos={data.items}
              index={index}
              onIndexChange={(next) => setPhoto(photoKey(data.items[next]), true)}
              onClose={() => setPhoto(null, true)}
              onReturnFocus={returnFocus}
            />
          </>
        );
      }}
    </PublicBoundary>
  );
}

function AlbumView({ album }: { album: PublicEntry }) {
  const title = album.title ?? album.slug ?? "";
  usePageMeta({
    title,
    description: summarize(album.payload.description),
    image: imageOf(album.payload.cover, "web")?.src ?? null,
    index: true,
  });
  return (
    <>
      <Crumbs items={[{ label: copy["site.album"], to: "/album/albums" }, { label: title }]} />
      <FrontTitle>{title}</FrontTitle>
      <MarkdownBody source={album.payload.description} className="mb-8 text-subdued" />
      <PhotoWall albumId={album.id} />
    </>
  );
}

export function AlbumDetail() {
  const { slug = "" } = useParams();
  const album = useQuery(publicQueries.bySlug(api.public, "album", slug));
  return (
    <PublicBoundary query={album} level="page" skeleton={<DetailSkeleton />}>
      {(entry) => <AlbumView album={entry} />}
    </PublicBoundary>
  );
}

/** F-S3 aside: the album link and previous / next inside the album. Missing album or siblings: those parts are left out. */
function PhotoAside({ photo, albumId }: { photo: PublicEntry; albumId: string }) {
  const album = useQuery({ ...publicQueries.byId(api.public, "album", albumId), enabled: albumId !== "" });
  const siblings = useQuery({ ...albumPhotos(albumId), enabled: albumId !== "" });
  const items = siblings.data?.items ?? [];
  const at = items.findIndex((item) => item.id === photo.id);
  const previous = at > 0 ? items[at - 1] : undefined;
  const next = at >= 0 && at < items.length - 1 ? items[at + 1] : undefined;
  const takenAt = formatDate(photo.payload.takenAt);
  const caption = text(photo.payload.caption);
  return (
    <div className="flex flex-col gap-4">
      {album.data ? (
        <p className="text-subdued" data-testid="photo-album">
          {copy["photo.inAlbum"]}{" "}
          {album.data.slug ? (
            <Link to={`/album/albums/${album.data.slug}`} className="underline">
              {album.data.title ?? album.data.slug}
            </Link>
          ) : (
            album.data.title
          )}
        </p>
      ) : null}
      <FrontTitle>{photo.title ?? copy["photo.fallbackTitle"]}</FrontTitle>
      {caption ? <p>{caption}</p> : null}
      {takenAt ? (
        <dl className="flex gap-2 text-subdued">
          <dt>{copy["photo.takenAt"]}</dt>
          <dd data-testid="photo-taken-at">{takenAt}</dd>
        </dl>
      ) : null}
      <div className="flex gap-6">
        {previous?.slug ? (
          <Link to={`/album/photos/${previous.slug}`} className="underline" data-testid="photo-previous">
            {copy["photo.previous"]}
          </Link>
        ) : null}
        {next?.slug ? (
          <Link to={`/album/photos/${next.slug}`} className="underline" data-testid="photo-next">
            {copy["photo.next"]}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function PhotoView({ photo }: { photo: PublicEntry }) {
  const image = imageOf(photo.payload.media, "web");
  const caption = text(photo.payload.caption);
  const albumId = text(photo.payload.album);
  usePageMeta({ title: photo.title ?? copy["photo.fallbackTitle"], description: summarize(caption), image: image?.src ?? null, index: true });
  return (
    <>
      <Crumbs items={[{ label: copy["site.album"], to: "/album/albums" }, { label: photo.title ?? copy["photo.fallbackTitle"] }]} />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[2fr_1fr]">
        <div>
          {image ? (
            <PublicImage
              image={image}
              alt={altOf(photo.payload.media, caption, photo.title)}
              loading="eager"
              className="h-auto max-h-[80vh] w-full rounded-xl object-contain"
              testId="photo-image"
            />
          ) : (
            <p className="text-subdued">{copy["photo.noImage"]}</p>
          )}
        </div>
        <PhotoAside photo={photo} albumId={albumId} />
      </div>
    </>
  );
}

export function PhotoPage() {
  const { slug = "" } = useParams();
  const photo = useQuery(publicQueries.bySlug(api.public, "photo", slug));
  return (
    <PublicBoundary query={photo} level="page" skeleton={<DetailSkeleton />}>
      {(entry) => <PhotoView key={entry.id} photo={entry} />}
    </PublicBoundary>
  );
}
