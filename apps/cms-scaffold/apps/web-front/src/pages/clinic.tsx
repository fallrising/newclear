import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { publicQueries, type PublicEntry } from "@cms/api/public";
import { api } from "../api";
import { copy } from "../copy";
import { ListPage } from "../home";
import { MarkdownBody } from "../markdown";
import { altOf, imageOf } from "../media";
import { Crumbs, EnumBadge, PublicImage } from "../parts";
import { summarize, usePageMeta } from "../seo";
import { FrontTitle } from "../shell";
import { VET_GRID } from "../sites";
import { DetailSkeleton, PublicBoundary } from "../states";

export function VetList() {
  return (
    <ListPage
      grid={VET_GRID}
      title={copy["vets.title"]}
      crumbs={[{ label: copy["site.clinic"], to: "/clinic" }, { label: copy["vets.title"] }]}
      description={copy["selector.clinic.body"]}
    />
  );
}

/** Vet page (surface-front §7.4 whitelist: title, specialty, bio, photo). */
function VetView({ vet }: { vet: PublicEntry }) {
  const title = vet.title ?? "";
  const photo = imageOf(vet.payload.photo, "web");
  usePageMeta({ title, description: summarize(vet.payload.bio), image: photo?.src ?? null, index: true });
  return (
    <>
      <Crumbs items={[{ label: copy["site.clinic"], to: "/clinic" }, { label: copy["vets.title"], to: "/clinic/vets" }, { label: title }]} />
      <div className="grid grid-cols-1 gap-8 md:grid-cols-[1fr_2fr]">
        {photo ? (
          <PublicImage image={photo} alt={altOf(vet.payload.photo, title)} loading="eager" className="h-auto w-full rounded-xl object-cover" testId="vet-photo" />
        ) : null}
        <div className="md:col-start-2">
          <FrontTitle actions={<EnumBadge type="vet" field="specialty" value={vet.payload.specialty} />}>{title}</FrontTitle>
          <MarkdownBody source={vet.payload.bio} />
        </div>
      </div>
    </>
  );
}

export function VetPage() {
  const { slug = "" } = useParams();
  const vet = useQuery(publicQueries.bySlug(api.public, "vet", slug));
  return (
    <PublicBoundary query={vet} level="page" skeleton={<DetailSkeleton />}>
      {(entry) => <VetView vet={entry} />}
    </PublicBoundary>
  );
}
