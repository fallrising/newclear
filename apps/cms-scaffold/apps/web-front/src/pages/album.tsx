import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { publicQueries } from "@cms/api/public";
import { Card, CardContent, EmptyState, QueryBoundary } from "@cms/ui";
import { api } from "../api";
import { copy } from "../copy";
import { mediaUrl, text } from "../media";
import { FrontTitle } from "../shell";

export function AlbumHome() {
  const albums = useQuery(publicQueries.entries(api.public, "album"));
  return (
    <>
      <FrontTitle actions={<Link to="/album/albums" className="hover:underline">{copy["album.all"]}</Link>}>
        {copy["album.title"]}
      </FrontTitle>
      <QueryBoundary
        query={albums}
        isEmpty={(page) => page.items.length === 0}
        empty={<EmptyState title={copy["empty.albums"]} description={copy["empty.albums.body"]} />}
      >
        {(page) => (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {page.items.map((album) => {
              const src = mediaUrl(album.payload.cover);
              return (
                <Link key={album.id} to={`/album/albums/${album.slug ?? album.id}`} className="rounded-xl" data-testid="album-card">
                  <Card className="h-full overflow-hidden pt-0">
                    {src ? <img src={src} alt="" className="aspect-[4/3] w-full object-cover" /> : null}
                    <CardContent>
                      <h2 className="font-display text-front-heading">{album.title ?? album.slug}</h2>
                      <p className="text-subdued">{text(album.payload.description)}</p>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </QueryBoundary>
    </>
  );
}

function AlbumNotFound() {
  return (
    <>
      <FrontTitle>{copy["album.notFound.title"]}</FrontTitle>
      <p className="text-subdued">{copy["album.notFound.body"]}</p>
    </>
  );
}

function AlbumPhotos({ albumId }: { albumId: string }) {
  const photos = useQuery(publicQueries.entries(api.public, "photo", { ref: { album: albumId } }));
  return (
    <QueryBoundary query={photos} isEmpty={(page) => page.items.length === 0} empty={<EmptyState title={copy["empty.photos"]} />}>
      {(page) => (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {page.items.map((photo) => {
            const src = mediaUrl(photo.payload.media);
            const caption = text(photo.payload.caption);
            return (
              <Link key={photo.id} to={`/album/photos/${photo.slug ?? photo.id}`} data-testid="photo-tile">
                {src ? <img src={src} alt={caption || photo.title || ""} className="aspect-square w-full rounded-lg object-cover" /> : null}
                {caption ? <p className="mt-1 text-subdued">{caption}</p> : null}
              </Link>
            );
          })}
        </div>
      )}
    </QueryBoundary>
  );
}

export function AlbumDetail() {
  const { slug = "" } = useParams();
  const album = useQuery(publicQueries.bySlug(api.public, "album", slug));
  return (
    <QueryBoundary query={album} notFound={<AlbumNotFound />}>
      {(entry) => (
        <>
          <FrontTitle>{entry.title ?? slug}</FrontTitle>
          <p className="mb-6 text-subdued">{text(entry.payload.description)}</p>
          <AlbumPhotos albumId={entry.id} />
        </>
      )}
    </QueryBoundary>
  );
}

export function PhotoPage() {
  const { slug = "" } = useParams();
  // v1 behaviour: the segment may be a slug or, for photos without one, an id.
  const photo = useQuery({
    queryKey: ["public", "photoPage", slug],
    queryFn: ({ signal }) => api.public.bySlug("photo", slug, signal).catch(() => api.public.byId("photo", slug, signal)),
  });
  return (
    <QueryBoundary
      query={photo}
      notFound={
        <>
          <FrontTitle>{copy["photo.notFound.title"]}</FrontTitle>
          <p className="text-subdued">{copy["photo.notFound.body"]}</p>
        </>
      }
    >
      {(entry) => {
        const src = mediaUrl(entry.payload.media);
        const caption = text(entry.payload.caption);
        return (
          <>
            <FrontTitle>{entry.title ?? copy["photo.fallbackTitle"]}</FrontTitle>
            {src ? (
              <img src={src} alt={caption || entry.title || ""} className="max-h-[80vh] w-full rounded-xl object-contain" />
            ) : (
              <p className="text-subdued">{copy["photo.noImage"]}</p>
            )}
            {caption ? <p className="mt-4 text-subdued">{caption}</p> : null}
          </>
        );
      }}
    </QueryBoundary>
  );
}
